var ChildProcess = require('child_process');
var Path = require('path');
var FS = require('fs');

Runner.timeout = 1000;
module.exports = Runner;
var runnerCache = {};
var runnerBatch = {};
function Runner(path, callback) {
  if (runnerCache[path]) {
    var cache = runnerCache[path];
    FS.stat(path, function (err, stat) {
      if (!err && stat.mtime.valueOf() === cache.mtime) {
        return callback(null, cache.value);
      }
      delete runnerCache[path];
      return Runner(path, callback);
    });
    return;
  }
  if (runnerBatch[path]) {
    runnerBatch[path].push(callback);
    return;
  }
  var batch = runnerBatch[path] = [callback];
  realRunner(path, function (err, value) {
    if (!err) {
      FS.stat(path, function (err, stat) {
        if (!err) {
          runnerCache[path] = {
            value: value,
            mtime: stat.mtime.valueOf()
          };
        }
      });
    }
    delete runnerBatch[path];
    for (var i = 0, l = batch.length; i < l; i++) {
      batch[i].apply(null, arguments);
    }
  });
}

function realRunner(path, callback) {
  var isDone;
  var start = Date.now();
  var events = [{start: start}];
  var timeout = setTimeout(function () {
    if (isDone) return;
    pushEvent({timeout: true})
    isDone = true;
    child.kill();
    callback(null, events);
  }, Runner.timeout);
  var child = ChildProcess.spawn(process.execPath, [path], {
    cwd: Path.dirname(path)
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.on("error", function (err) {
    if (isDone) return;
    pushEvent({error: err})
    isDone = true;
    clearTimeout(timeout);
    callback(err, events);
  });
  child.stdout.on('data', function (chunk) {
    if (isDone) return;
    pushEvent({stdout: chunk})
  });
  child.stderr.on('data', function (chunk) {
    if (isDone) return;
    pushEvent({stderr: chunk})
  });
  child.on('exit', function (code, signal) {
    if (isDone) return;
    pushEvent({exit: code, signal:signal});
    isDone = true;
    clearTimeout(timeout);
    callback(null, events);
  });
  function pushEvent(event) {
    var now = Date.now();
    event.delay = now - start;
    start = now;
    events.push(event);
  }
}