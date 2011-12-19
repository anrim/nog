var Path = require('path');
var JsonDB = require('jsondb');
var Corn = require('corn');
var Stack = require('stack');
var FS = require('fs');
var Markdown = require('markdown').markdown;
var Creationix = require('creationix');

module.exports = function setup(path, options) {
  options = options || {};
  var templateDir = options.templateDir || Path.join(path, "templates");
  var resourceDir = options.resourceDir || Path.join(path, "resources");
  var db = JsonDB(path, ".markdown");

  var templateCache = {};
  var readBatch = {};
  var helpers = {
    render: render,
    query: query,
    renderQuery: function (name, file, path, callback) {
      if (typeof path === "function" && callback === undefined) {
        callback = path;
        path = [];
      }
      query(file, path, function (err, data) {
        if (err) return callback(err);
        render(name, data, callback);
      });
    },
    markdown: function (input, callback) {
      var html;
      try {
        var tree = Markdown.parse(input);
        dropCap(tree);
        html = Markdown.toHTML(tree)
      } catch (err) {
        return callback(err);
      }
      process.nextTick(function () {
        callback(null, html);
      });
    },
    markdownTruncated: function (input, callback) {
      var html;
      try {
        var tree = Markdown.parse(input);
        truncate(tree);
        dropCap(tree);
        html = Markdown.toHTML(tree)
      } catch (err) {
        return callback(err);
      }
      process.nextTick(function () {
        callback(null, html);
      });
    }
  };

  return Stack.compose(
    Creationix.static("/", resourceDir),
    Creationix.route("GET", "/", function (req, res, params, next) {
      render("frontindex", {}, function (err, html) {
        if (err) return next(err);
        res.writeHead(200, {
          "Content-Length": Buffer.byteLength(html),
          "Content-Type": "text/html; charset=utf-8"
        });
        res.end(html);
      });
    }),
    Creationix.route("GET",  "/:article", function (req, res, params, next) {
      query("articles/" + params.article, function (err, article) {
        if (err) {
          if (err.code === "ENOENT") return next();
          return next(err);
        }
        render("articleindex", article, function (err, html) {
          if (err) return next(err);
          res.writeHead(200, {
            "Content-Length": Buffer.byteLength(html),
            "Content-Type": "text/html; charset=utf-8"
          });
          res.end(html);
        });
      });
    })
  );

  // Query a field from the database
  function query(file, path, callback) {
    if (typeof path === "function" && callback === undefined) {
      callback = path;
      path = [];
    }
    if (!callback) {
      return function (callback) {
        query(file, path, callback);
      }
    }
    if (typeof path === 'string') path = path.split('.');
    db.get(file, function (err, data) {
      if (err) return callback(err);
      for (var i = 0, l = path.length; i < l; i++) {
        var part = path[i];
        if (!data.hasOwnProperty(part)) {
          return callback(new Error("Bad path " + part));
        }
        data = data[path[i]];
      }
      data._file = file;
      data._name = Path.basename(file);
      data._path = path.join(".");
      callback(null, data);
    });
  }


  // Main entry point for data rendering
  function render(name, data, callback) {
    console.log('render(' + JSON.stringify(name) + ', ' + JSON.stringify(data));
    // Allow query data
    if (typeof data === "string") return query(data, function (err, data) {
      if (err) return callback(err);
      render(name, data, callback);
    });
    // Allow lazy data
    if (typeof data === "function") return data(function (err, data) {
      if (err) return callback(err);
      render(name, data, callback);
    });
    // Allow looping over data
    if (Array.isArray(data)) return renderArray(name, data, callback);

    // Compile and render a template
    data.__proto__ = helpers;
    compile(name, function (err, template) {
      if (err) return callback(err);
      template(data, callback);
    });
  }

  function renderArray(name, array, callback) {
    if (array.length === 0) return callback(null, "");
    var left = array.length;
    var parts = [];
    array.forEach(function (data, i) {
      render(name, data, function (err, html) {
        if (err) return callback(err);
        parts[i] = html;
        left--;
        if (left === 0) {
          callback(null, parts.join(""));
        }
      });
    });
  }

  // A caching and batching template loader and compiler
  function compile(name, callback) {
    if (templateCache.hasOwnProperty(name)) {
      var template = templateCache[name];
      process.nextTick(function () {
        callback(null, template);
      });
      return;
    }
    if (readBatch.hasOwnProperty(name)) {
      readBatch[name].push(callback);
      return;
    }
    readBatch[name] = [callback];
    realCompile(name, function (err, template) {
      if (!err) {
        templateCache[name] = template;
        setTimeout(function () {
          delete templateCache[name];
        }, 1000);
      }
      var batch = readBatch[name];
      delete readBatch[name];
      for (var i = 0, l = batch.length; i < l; i++) {
        batch[i](err, template);
      }
    });
  }

  function realCompile(name, callback) {
    FS.readFile(Path.join(templateDir, name + ".html"), "utf8", function (err, source) {
      if (err) return callback(err);
      try {
        var template = Corn(source);
      } catch (err) {
        return callback(err);
      }
      callback(null, template);
    });
  }

};

function dropCap(tree) {
  var line = tree[0] === "markdown" && Array.isArray(tree[1]) && tree[1][0] === "para" && tree[1][1];
  var i = line && line.indexOf(" ");
  if (i < 0) {
    console.log("Warning, can't find first letter to drop caps", line);
    return;
  }
  var word = line.substr(0, i);
  line = line.substr(i);
  tree[1][1] = line;
  tree[1].splice(1, 0, ["span", {"class": "drop-caps"}, word]);
}

function truncate(tree) {
  console.dir(tree);
  var i = 1;
  while (tree[i][0] !== "header") { i++; }
  tree.length = i;
}