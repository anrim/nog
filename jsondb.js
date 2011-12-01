var Path = require('path');
var FS = require('fs');
var EventEmitter = require('events').EventEmitter;
var Queue = require('./queue');
module.exports = createDB;

function createDB(root) {

  root = Path.resolve(process.cwd(), root);
  
  // Make sure we have a directory to work with
  var stat;
  try {
    stat = FS.statSync(root);
  } catch (err) {
    // try to create it if it's not there
    if (err.code === "ENOENT") {
      FS.mkdirSync(root);
      stat = FS.statSync(root);
    } else {
      throw err;
    }
  } 
  if (!stat.isDirectory()) {
    throw new Error("Path " + root + " is not a directory.");
  }

  var getLock = {};
  var writeLock = {};

  var db = new EventEmitter();

  db.get = function (path, callback) {
    if (getLock.hasOwnProperty(path)) {
      getLock[path].push(callback);
      return;
    };
    var queue = getLock[path] = [callback];
    get(path, function (err, data) {
      delete getLock[path];
      for (var i = 0, l = queue.length; i < l; i++) {
         queue[i](err, data); 
      }
    });
  };
  
  db.put = function (path, data, callback) {
    if (writeLock.hasOwnProperty(path)) {
      writeLock[path].push({data: data, callback: callback});
      return;
    }
    var lock = writeLock[path] = new Queue();
    
    function onePut(data, callback) {
      put(path, data, function (err) {
        callback(err);
        db.emit("change", path, data);
        var next = lock.shift();
        if (next) {
          onePut(next.data, next.callback);
        } else {
          delete writeLock[path];
        }
      });
    }
    onePut(data, callback);
  };
  
  return db;

  /////////////////////////////////////////////

  // Lists entries in a folder
  function list(path, callback) {
    path = Path.resolve(root, path);
    FS.readdir(path, function (err, files) {
      if (err) return callback(err);
      var entries = [];
      files.forEach(function (file) {
        var i = file.length - 5;
        if (file.substr(i) === ".json") {
          entries.push(file.substr(0, i));
        }
      });
      callback(null, entries);
    });
  }
  
  // Load an entry
  function get(path, callback) {
    var jsonPath = Path.resolve(root, path + ".json");
    FS.readFile(jsonPath, function (err, json) {
      if (err) {
        if (err.code === "ENOENT") {
          return list(path, callback); 
        }
        return callback(err);
      }
      var data;
      try {
        data = JSON.parse(json);
      } catch (err) {
        return callback(new Error("Invalid JSON in " + jsonPath + "\n" + err.message));
      }
      var markdownPath = Path.resolve(root, path + ".markdown");
      FS.readFile(markdownPath, 'utf8', function (err, markdown) {
        if (err) {
          if (err.code !== "ENOENT") {
            return callback(err);
          }
        } else {
          data.markdown = markdown;
        }
        callback(null, data);
      });
    });
  }
  
  // Put an entry
  function put(path, data, callback) {
    var json;
    if (data.hasOwnProperty("markdown")) {
      Object.defineProperty(data, "markdown", {enumerable: false});
      json = JSON.stringify(data);
      Object.defineProperty(data, "markdown", {enumerable: true});
    } else {
      json = JSON.stringify(data);
    }
    var jsonPath = Path.resolve(root, path + ".json");
    FS.writeFile(jsonPath, json, function (err) {
      if (err) return callback(err);
      if (data.hasOwnProperty("markdown")) {
        var markdownPath = Path.resolve(root, path + ".markdown");
        FS.writeFile(markdownPath, data.markdown, callback);
        return;
      }
      callback();
    });
  }
  
  
}

////////////////////////////////////////////////////////////////////////////////

var db = createDB("data");

var start = 10000;
var num = start;
var before = Date.now();
console.log("%s serial reads", start);
getNext();
function getNext() {
  db.get("articles/myfirst", function (err, article) {
    if (err) throw err;
    num--;
    if (num) {
      process.nextTick(getNext);
    } else {
      console.log(Math.floor(start / (Date.now() - before) * 10000)/10, "per second");
      two();
    }
  });
}

function two() {
  before = Date.now();
  var left = start;
  console.log("%s parallel reads", left);
  for (var i = 0; i < start; i++) {
    db.get("articles/myfirst", function (err, article) {
      if (err) throw err;
      left--;
      if (!left) {
        console.log(Math.floor(start / (Date.now() - before) * 10000)/10, "per second");
        three();
      }
    });
  }
}

var article = {"name":"tim", markdown:"This\nis\na\ntest\n."};
function three() {
  num = start;
  before = Date.now();
  console.log("%s serial writes", start);
  writeNext();
  function writeNext() {
    db.put("articles/test", article, function (err) {
      if (err) throw err;
      num--;
      if (num) {
        process.nextTick(writeNext);
      } else {
        console.log(Math.floor(start / (Date.now() - before) * 10000)/10, "per second");
        four();
      }
    });
  }
  
}

function four() {
  before = Date.now();
  var left = start;
  console.log("%s parallel writes", left);
  for (var i = 0; i < start; i++) {
    db.put("articles/myfirst", article, function (err) {
      if (err) throw err;
      left--;
      if (!left) {
        console.log(Math.floor(start / (Date.now() - before) * 10000)/10, "per second");
      }
    });
  }
}

// db.get("articles", console.log)
// db.get("articles/myfirst", function (err, article) {
//   if (err) throw err;
//   console.log("article loaded", article);
//   db.put("articles/clone", article, function (err) {
//     if (err) throw err;
//     console.log("article cloned");
//   });
// });
