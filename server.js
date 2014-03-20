/*

General
* add cpu % into the output

Console view
* show headers every n rows
* add back in filter and property support
* if property and no filter, make the columns be processes, with values

Web view
* when you run server, open monitor in a browser

*/

var cols = [
  'NAME',
  'PID',
  'PPID',
  'CPU(s)',
  'NICE',
  'USS',
  'PSS',
  'RSS',
  'VSIZE',
  'OOM_ADJ',
  'USER'
];

var valueCols = [
  'CPU(s)',
  'NICE',
  'USS',
  'PSS',
  'RSS',
  'VSIZE',
  'OOM_ADJ',
];

var program = require('commander');
program
  .version('0.0.1')
  .option('-w, --web', 'view in awesome web page instead of console')
  .option('-f, --filter <n>', 'string filter')
  .option('-p, --property <n>', 'string property: ' + cols.join(', '))
  .option('-h, --hint', 'show +/- next to each value when there is a change')
  .parse(process.argv);

var headersShown = false,
    inProcessTable = false,
    lastRecord = null,
    processNames = []
    processRecords = [],
    lastProcessCount = 0
    recordLength = 11;

// console
// stream handler of b2g-info data
function consoleReporter(data) {
  function splitLine(line) {
    return line.trim().replace(/ +/g, ',').split(',')
    /*
    var fields = line.trim().replace(/ +/g, ',').split(','),
        record = [];
    for (var i = fields.length; i > 0; i--) {
      record.unshift(fields[i]) 
    }
    */
  }

  data.split('\n').forEach(function(line) {
    line = line.trim()
    //if (line.length) console.log(line.trim())
    var record = splitLine(line);
    if (record[0] == 'NAME') {
      inProcessTable = true;
      if (!program.property && !headersShown) {
        headersShown = true;
        console.log(splitLine(line).join('\t'));
      }
    }
    // in process table?
    else if (inProcessTable && record.length >= recordLength) {
      inProcessTable = true;

      // no filter, or matches filter?
      if (!program.filter || (program.filter && record[0] == program.filter)) {
        var name = record[0];

        // check filter
        if (program.filter && name.indexOf(program.filter) == -1)
          return;
        
        // record process name
        if (processNames.indexOf(name) == -1)
          processNames.push(name)

        // hack for first record
        if (!lastRecord)
          lastRecord = record

        // markup changed values with +/-
        if (program.hint) {
          valueCols.forEach(function(col) {
            var valueIndex = cols.indexOf(col),
                thisValue = record[ valueIndex ],
                lastValue = lastRecord[ valueIndex ].replace('+', '').replace('-', '');
            if (thisValue > lastValue) {
              record[valueIndex] = thisValue + '+';
            }
            else if (lastValue > thisValue) {
              record[valueIndex] = thisValue + '-';
            }
          })
        }

        // if not viewing by a single property, display all properties in row
        if (!program.property) {
          record[0] = record[0].substr(0, 6);
          console.log(record.join('\t'));
        }
        // otherwise store value to later print out process columns
        else {
          var nameIndex = processNames.indexOf(name),
              propertyValue = record[ cols.indexOf(program.property) ];
          processRecords[ nameIndex ] = propertyValue;
        }
        lastRecord = record;
      }
    }
    // first line after process table?
    else if (program.property && inProcessTable && record.length < recordLength) {
      if (lastProcessCount != processNames.length) {
        console.log(processNames.join('\t'));
        lastProcessCount = processNames.length
      }
      else {
        console.log(processRecords.join('\t'));
        processNames = [];
        processRecords = [];
      }
      inProcessTable = false;
    }
  })
}

// web
if (program.web) {
  // open monitor in browser 
  var open = require("open")
  open('http://localhost/monitor/monitor-rickshaw.html')

  // initialize socket
  var io = require('socket.io').listen(8088);
  io.sockets.on('connection', function (socket) {

    // passthru data to socket
    function webReporter(data) {
      console.log('webReporter', data)
      socket.emit('tick', data)
    }
    // stream b2g-info data to socket
    b2gInfoProcessor(webReporter)
    
    // stream b2g-info data to socket
    topProcessor(webReporter)

  });
}
// console
else {
  // passthru data to socket
  function consoleReporter(data) {
    console.log(data.data.join('\t'));
    //console.log(data);
  }
  // stream b2g-info data to socket
  b2gInfoProcessor(consoleReporter)
  
  // stream b2g-info data to socket
  topProcessor(consoleReporter)
}

function topProcessor(callback) {
  // adb shell top -m 5
  var args = ["shell", "top -m 5"],
      spawn = require('child_process').spawn,
      proc = spawn('adb', args);
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', processChunk);

  var system = {},
      headers = [],
      processes = []

  var inProcessTable = false;

  function splitLine(line) {
    return line.trim().replace(/ +/g, ',').split(',');
  }

  function processChunk(data) {
    data.split('\n').filter(function(l) { return l.length; }).forEach(function(line) {
      line = line.trim()
      if (!line.length)
        return;
      var record = splitLine(line);
      if (record[0] == 'User') {
        inProcessTable = false;
        if (headers.length && processes.length) {
          callback({
            type: 'top',
            system: system,
            headers: headers.splice(0),
            data: processes.splice(0)
          });
          system = {};
        }
        if (record.length == 11) {
          line.split(',').forEach(function(field) {
            var entry = field.trim().split(' ');
            system[entry[0]] = entry[1];
          }, {});
        }
      }
      else if (record[0] == 'PID') {
        inProcessTable = true;
        headers = record;
      }
      else {
        processes.push(record);
      }
    });
  }
}

function b2gInfoProcessor(callback) {
  var processHeaders = null,
      processRecords = [],
      systemHeaders = null,
      systemRecords = [],
      inProcessTable = false,
      inSystemTable = false;

  function splitLine(line) {
    return line.trim().replace(/ +/g, ',').split(',');
  }

  function processChunk(data) {
    data.split('\n').forEach(function(line) {
      line = line.trim()
      //console.log('LINE:', inProcessTable, line.length, line)
      var record = splitLine(line);
      // column header line to detect process table
      if (line && record[0] == 'NAME') {
        processHeaders = record;
        inProcessTable = true;
      }
      // in process table?
      else if (inProcessTable && line.length) {
        // Fixup for process names with spaces
        if (record.length > 11) {
          var processName = record.splice(0, record.length - 10).join(' ');
          record.unshift(processName);
        }
        // store record
        processRecords.push(record)
      }
      // first line after process table?
      else if (inProcessTable && line.length === 0) {
        callback({
          type: 'process',
          headers: processHeaders,
          data: processRecords.splice(0)
        });
        inProcessTable = false;
      }
      // detect system memory info
      else if (line.indexOf('System memory info:') == 0) {
        inSystemTable = true;
      }
      else if (inSystemTable && line.length) {
        record.pop();
        if (record.length > 2) {
          var category = record.splice(0, record.length - 1).join(' ');
          record.unshift(category);
        }
        systemRecords.push(record);
      }
      else if (inSystemTable && line.length === 0 && systemRecords.length) {
        callback({
          type: 'system',
          data: systemRecords.splice(0)
        });
        inSystemTable = false;
      }
    });
  }

  var args = ["shell", "while true; do b2g-info; sleep 1; done"],
      spawn = require('child_process').spawn,
      proc = spawn('adb', args);
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', processChunk);
}
