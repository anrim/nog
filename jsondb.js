var Path = require('path');
var FS = require('fs');
var EventEmitter = require('events').EventEmitter;
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
  if (!stat.isDirectory()) { throw new Error("Path " + root + " is not a directory."); }

  var locks = {};

  var db = new EventEmitter();
  db.list = list;
  db.get = get;
  db.save = save;
  return db;

  /////////////////////////////////////////////

//  function lock(path) {
//    if (locks.hasOwnProperty(path)) 
//  }

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
      if (err) return callback(err);
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
  
  // Save an entry
  function save(path, data, callback) {
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
console.log("db", db);
db.list("articles", console.log)
db.get("articles/myfirst", function (err, article) {
  if (err) throw err;
  console.log("article loaded", article);
  db.save("articles/clone", article, function (err) {
    if (err) throw err;
    console.log("article cloned");
  });
});
