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
  var queryCache = {};
  var queryBatch= {};
  var helpers = {
    render: render,
    query: query,
    renderQuery: renderQuery,
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

  warehouse();

  var middleware = Stack.compose(
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

  middleware.warehouse = warehouse;

  return middleware;

  function warehouse() {
    var tags = {};
    var authors = {};
    var articleDates = {};
    var nodeVersions = {};
    db.get("articles", function (err, articles) {
      if (err) throw err;
      var left = articles.length;
      articles.forEach(function (articleName) {
        articleName = "articles/" + articleName;
        db.get(articleName, function (err, article) {
          articleDates[articleName] = (new Date(article.date)).valueOf();
          var majorVersion = article.nodeVersion.substr(0, article.nodeVersion.lastIndexOf('.'));
          var list = nodeVersions[majorVersion];
          if (!list) {
            list = nodeVersions[majorVersion] = [];
          }
          list.push(articleName);
          var list = authors[article.author]
          if (!list) {
            list = authors[article.author] = [];
          }
          list.push(articleName);
          if (article.tags) {
            article.tags.forEach(function (tagName) {
              var list = tags[tagName];
              if (!list) {
                list = tags[tagName] = [];
              }
              list.push(articleName);
            });
          }
          left--;
          if (left === 0) {
            var articleNames = Object.keys(articleDates);
            articleNames.sort(function (a, b) {
              return articleDates[b] - articleDates[a];
            });
            db.put("index", {
              articles: articleNames,
              tags: Object.keys(tags).map(function (tag) { return {tag:tag}; }),
              tagsArticles: tags,
              authors: Object.keys(authors),
              authorsArticles: authors,
              versions: Object.keys(nodeVersions).map(function (version) { return {version:version}; }),
              versionsArticles: nodeVersions
            }, function (err) {
              if (err) throw err;
              console.log("Done with warehousing")
            });
          }
        });
      });
    })
  }

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
    var key = file + "|" + path;

    if (queryCache.hasOwnProperty(key)) {
      callback(null, queryCache[key]);
      return;
    }
    if (queryBatch.hasOwnProperty(key)) {
      queryBatch[key].push(callback);
      return;
    }
    queryBatch[key] = [callback];
    realQuery(file, path, function (err, data) {
      if (!err) {
        queryCache[key] = data;
        setTimeout(function () {
          delete queryCache[key];
        }, 1000);
      }
      var batch = queryBatch[key];
      delete queryBatch[key];
      for (var i = 0, l = batch.length; i < l; i++) {
        batch[i](err, data);
      }
    });
  }

  function realQuery(file, path, callback) {
    db.get(file, function (err, data) {
      if (err) return callback(err);
      for (var i = 0, l = path.length; i < l; i++) {
        var part = path[i];
        if (!data.hasOwnProperty(part)) {
          return callback(new Error("Bad path " + part));
        }
        data = data[path[i]];
      }
      Object.defineProperty(data, "_file", {value: file});
      Object.defineProperty(data, "_name", {value: Path.basename(file)});
      Object.defineProperty(data, "_path", {value: path.join(".")});
      callback(null, data);
    });
  }


  // Main entry point for data rendering
  function render(name, data, callback) {
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

  function renderQuery(name, file, path, callback) {
    if (typeof path === "function" && callback === undefined) {
      callback = path;
      path = [];
    }
    query(file, path, function (err, data) {
      if (err) return callback(err);
      render(name, data, callback);
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
      callback(null, templateCache[name]);
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
  var i = 1;
  while (tree[i][0] !== "header") { i++; }
  tree.length = i;
}