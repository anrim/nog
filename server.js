var Http = require('http'),
    Stack = require('stack'),
    Creationix = require('creationix'),
    createDB = require('jsondb'),
    Corn = require('corn'),
    FS = require('fs'),
    Path = require('path');

var port = process.env.PORT || 8080;

var db = createDB(Path.join(__dirname, "data"));


Http.createServer(Stack(
  Creationix.log(),
  Creationix.route("GET", "/", function (req, res, params, next) {
    render("frontindex", {
      title: query("index", "title"),
      links: query("index", "links"),
      articles: loadArticles()
    }, function (err, html) {
      if (err) return next(err);
      res.writeHead(200, {
        "Content-Length": Buffer.byteLength(html),
        "Content-Type": "text/html; charset=utf-8"
      });
      res.end(html);
    });
  }),
  Creationix.static("/", Path.join(__dirname, "public"))
)).listen(port);

function loadArticles() {
  return function (callback) {
    query("index", "articles", function (err, list) {
      if (err) return callback(err);
      var articles = new Array(list.length);
      var left = articles.length;
      list.forEach(function (name, i) {
        query("articles/" + name, function (err, article) {
          if (err) return callback(err);
          query("authors/" + article.author, function (err, author) {
            if (err) return callback(err);
            article.author = author;
            articles[i] = article;
            left--;
            if (left === 0) {
              callback(null, articles);
            }
          });
        });
      });
    });
  }
}
console.log("Server listening at http://localhost:%s/", port);

var templateDir = Path.join(__dirname, "templates");

Corn.helpers = {
  render: render,
  query: query,
};

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
    callback(null, data);
  });
}


// Main entry point for data rendering
function render(name, data, callback) {
  // Allow lazy data
  if (typeof data === "function") return data(function (err, data) {
    if (err) return callback(err);
    render(name, data, callback);
  });
  // Allow looping over data
  if (Array.isArray(data)) return renderArray(name, data, callback);

  // Compile and render a template
  data.__proto__ = Corn.helpers;
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
var templateCache = {};
var readBatch = {};
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
