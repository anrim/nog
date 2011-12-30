var Path = require('path');
var FS = require('fs');
var JsonDB = require('jsondb');
var Kernel = require('kernel');
var Stack = require('stack');
var Markdown = require('markdown').markdown;
var Creationix = require('creationix');
var Prettyfy = require('prettyfy').prettyPrintOne;
var Url = require('url');
var QueryString = require('querystring');
var HTTPS = require('https');

module.exports = function setup(path, options) {
  options = options || {};
  var templateDir = options.templateDir || Path.join(path, "templates");
  var resourceDir = options.resourceDir || Path.join(path, "resources");
  var db = JsonDB(path, ".markdown");

  var queryCache = {};
  var queryBatch= {};
  var helpers = {
    render: render,
    query: query,
    highlight: function (code, callback) {
      var html;
      try {
        html = Prettyfy(code);
      } catch (err) {
        return callback(err);
      }
      callback(null, html);
    },
    blockIf: function (condition, block, callback) {
      if (condition) block({}, callback);
      else callback(null, "");
    },
    blockQuery: function (path, block, callback) {
      if (typeof path !== "string") {
        return callback(new Error("blockQuery variable should be string query"));
      }
      query(path, function (err, data) {
        if (err) return callback(err);
        block(data, callback);
      });
    },
    loopQuery: function (path, block, callback) {
      if (typeof path === "string") {
        query(path, loop);
      } else if (Array.isArray(path)) {
        loop(null, path);
      } else {
        return callback(new Error("loopQuery variable should be string query or array"));
      }
      function loop(err, array) {
        if (err) return error(err);
        var length = array.length, index = length - 1;
        var parts = new Array(length);
        array.forEach(function (data, i) {
          if (typeof data === "string") {
            query(data, function (err, data) {
              if (err) return error(err);
              block(data, done);
            });
          } else {
            block(data, done);
          }
          function done(err, result) {
            if (err) return error(err);
            parts[i] = result;
            check();
          }
        });
        var done = false;
        check();
        function error(err) {
          if (done) return;
          done = true;
          callback(err);
        }
        function check() {
          if (done) return;
          while (parts.hasOwnProperty(index)) { index--; }
          if (index < 0) {
            done = true;
            callback(null, parts.join(''));
          }
        }
      }
    },
    renderQuery: renderQuery,
    markdown: function (input, callback) {
      var html;
      try {
        var tree = Markdown.parse(input);
        dropCap(tree);
        processSnippets(tree, function (err, placeholders) {
          if (err) return callback(err);
          html = Markdown.toHTML(tree);
          Object.keys(placeholders).forEach(function (key) {
            html = html.replace(key, placeholders[key]);
          });
          callback(null, html);
        });
      } catch (err) {
        return callback(err);
      }
    },
    markdownTruncated: function (input, callback) {
      var html;
      try {
        var tree = Markdown.parse(input);
        truncate(tree);
        dropCap(tree);
        html = Markdown.toHTML(tree);
      } catch (err) {
        return callback(err);
      }
      process.nextTick(function () {
        callback(null, html);
      });
    }
  };

  var middleware = Stack.compose(
    Creationix.static("/", resourceDir),
    function (req, res, next) {
      if (!req.hasOwnProperty("uri")) { req.uri = Url.parse(req.url); }
      if (!req.hasOwnProperty("query")) { req.query = QueryString.parse(req.uri.query); }
      var settings;

      // Load settings from cookie
      if (req.headers.cookie) {
        settings = {};
        req.headers.cookie.split(";").forEach(function (part) {
          part = part.trim();
          var i = part.indexOf("=");
          if (i) {
            var key = part.substr(0, i);
            var value = part.substr(i + 1);
            settings[key] = value;
          }
        });
      }

      // If there is a query, merge it with settings and write a new cookie
      if (req.uri.query) {
        settings = settings || {};
        Object.keys(req.query).forEach(function (name) {
          settings[name] = req.query[name];
        });
        var value = Object.keys(settings).map(function (name) {
          req.query[name] = settings[name];
          return name + "=" + settings[name];
        });
        // Expires in one week
        value.push("Path=/");
        value.push("Expires=" + (new Date(Date.now() + 604800000)));
        value.push("HttpOnly");
        res.setHeader("Set-Cookie", value.join("; "));
      }

      // Put settings in query
      if (settings) {
        req.query = settings;
      }
      next();
    },
    Creationix.route("GET", "/", function (req, res, params, next) {
      query("index#articles", function (err, articles) {
        if (err) return next(err);
        render("frontindex", {req: req, articles: filterArticles(articles, req)}, sendToBrowser(req, res, next));
      });
    }),
    Creationix.route("GET", "/tags/:tag", function (req, res, params, next) {
      query("index#tagsArticles." + params.tag, function (err, articles) {
        if (err) {
          if (err.code === "ENOENT") return next();
          return next(err);
        }
        render("frontindex", {req: req, query: req.query, articles: filterArticles(articles, req)}, sendToBrowser(req, res, next));
      });
    }),
    Creationix.route("GET", "/authors/:author", function (req, res, params, next) {
      query("index#authorsArticles.authors/" + params.author, function (err, articles) {
        if (err) {
          if (err.code === "ENOENT") return next();
          return next(err);
        }
        render("frontindex", {req: req, articles: filterArticles(articles, req)}, sendToBrowser(req, res, next));
      });
    }),
    Creationix.route("GET", "/versions/:version", function (req, res, params, next) {
      query("index#versionsArticles." + params.version, function (err, articles) {
        if (err) {
          if (err.code === "ENOENT") return next();
          return next(err);
        }
        render("frontindex", {req: req, articles: filterArticles(articles, req)}, sendToBrowser(req, res, next));
      });
    }),
    Creationix.route("GET",  "/:article", function (req, res, params, next) {
      query("articles/" + params.article, function (err, article) {
        if (err) {
          if (err.code === "ENOENT") return next();
          return next(err);
        }
        render("articleindex", {req: req, article: article}, sendToBrowser(req, res, next));
      });
    })
  );

  middleware.warehouse = warehouse;

  // This is cheating, but makes it easy to get at.
  var articleDates = {};
  var nodeVersions = {};

  return middleware;

  function warehouse() {
    var tags = {};
    var authors = {};
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
          var list = authors[article.author];
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
            db.put("index", {
              articles: Object.keys(articleDates),
              articleDates: articleDates,
              tags: Object.keys(tags).map(function (tag) { return {tag:tag}; }),
              tagsArticles: tags,
              authors: Object.keys(authors),
              authorsArticles: authors,
              versions: Object.keys(nodeVersions).map(function (version) { return {version:version}; }),
              versionsArticles: nodeVersions
            }, function (err) {
              if (err) throw err;
              console.log("Done with warehousing");
            });
          }
        });
      });
    });
  }

  function sendToBrowser(req, res, next) {
    return function (err, html) {
      if (err) return next(err);
      res.writeHead(200, {
        "Content-Length": Buffer.byteLength(html),
        "Content-Type": "text/html; charset=utf-8"
      });
      res.end(html);
    };
  }

  // Query a field from the database
  function query(path, callback) {
    var i = path.indexOf("#");
    var file;
    if (i >= 0) {
      file = path.substr(0, i);
      path = path.substr(i + 1);
    } else {
      file = path;
      path = "";
    }
    var key = file + "|" + path;
    path = path ? path.split(".") : [];

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
          var err = new Error("Bad path " + part);
          err.code = "ENOENT";
          return callback(err);
        }
        data = data[path[i]];
      }
      if (data && typeof data === "object") {
        Object.defineProperty(data, "_file", {value: file});
        Object.defineProperty(data, "_name", {value: Path.basename(file)});
        Object.defineProperty(data, "_path", {value: path.join(".")});
      }
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
    var path = Path.join(templateDir, name + ".html");
    Kernel(path, function (err, template) {
      if (err) return callback(err);
      template(data, function (err, result) {
        if (err) {
          err.message += "\n" + require('util').inspect({file:path,locals:data});
          return callback(err);
        }
        callback(null, result);
      });
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

  function processSnippets(tree, callback) {
    var placeholders = {};
    var z = 0;
    var left = 0;
    tree.forEach(function (line, i) {
      if (!(Array.isArray(line) && line[0] === "code_block")) return;
      var code = line[1];
      if (code.substr(0, 2) !== "#@") return;
      var url = code.substr(2);
      var p = url.indexOf("#");
      var repo = url.substr(0, p);
      var file = url.substr(p + 1);
      var linestart = 0;
      var lineend = 0;
      p = file.indexOf(',');
      if (p >= 0) {
        var range = file.substr(p + 1);
        file = file.substr(0,p);
        p = range.indexOf("-");
        if (p >= 0) {
          linestart = parseInt(range.substr(0, p), 10);
          lineend = parseInt(range.substr(p + 1), 10);
        } else {
          linestart = lineend = parseInt(range, 10);
        }
      }
      left++;
      var query = {
        repo: repo, file: file, linestart: linestart, lineend: lineend
      };
      loadSnippet(query, function (err, code) {
        if (err) {
          tree[i] = ["pre", ["code", err.stack]];
          left--;
          if (left === 0) {
            callback(null, placeholders);
          }
          return;
        }
        render("snippet", {err:err,query:query,code:code}, function (err, html) {
          if (err) {
            tree[i] = ["pre", ["code", err.stack]];
          } else {
            var key = "{{{{" + (z++) + "}}}}";
            placeholders[key] = html;
            tree[i] = key;
          }
          left--;
          if (left === 0) {
            callback(null, placeholders);
          }
        });
      });
    });
    if (left === 0) callback();
  }

  // Sorts and filters articles based on query parameters
  function filterArticles(articles, req) {

    // Filter by node version if requested.
    if (req.query.node_version) {
      var version = req.query.node_version;
      articles = articles.filter(function (article) {
        return nodeVersions[version] && nodeVersions[version].indexOf(article) >= 0;
      });
    }

    // Sort by date
    articles.sort(function (a, b) {
      return articleDates[b] - articleDates[a];
    });
    return articles;

  }

};

function dropCap(tree) {
  var line = tree[0] === "markdown" && Array.isArray(tree[1]) && tree[1][0] === "para" && tree[1][1];
  var i = line && line.indexOf(" ");
  if (!(line || line === 0)) {
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
  while (tree[i] && tree[i][0] !== "header") { i++; }
  tree.length = i;
}

function loadSnippet(query, callback) {
  var repo = Url.parse(query.repo);
  var pathname = repo.pathname;
  var path;
  if (pathname.substr(pathname.length - 4) === ".git") {
    pathname = pathname.substr(0, pathname.length - 4);
  }
  switch (repo.hostname) {
    case "github.com":
      path = pathname + "/master/" + query.file;
      break;
    case "gist.github.com":
      path = "/gist" + pathname + "/" + query.file;
      break;
    default:
      callback(new Error("Unknown git provider " + repo.hostname));
      return;
  }
  HTTPS.get({
    host: "raw.github.com",
    headers: {Host: "raw.github.com"},
    path: path
  }, function (response) {
    if (response.statusCode !== 200) {
      return callback(new Error("Problem getting code from github.\n" + path + "\n" + JSON.stringify(response.headers)));
    }
    response.setEncoding('utf8');
    var data = "";
    response.on('data', function (chunk) {
      data += chunk;
    });
    response.on('error', callback);
    response.on('end', function () {
      var lines = data.split("\n");
      var linestart = parseInt(query.linestart, 10) || 0;
      var lineend = parseInt(query.lineend, 10) || 0;
      if (lineend) lines.length = lineend;
      if (linestart) lines = lines.slice(linestart - 1);
      callback(null, Prettyfy(lines.join("\n")));
    });
  });
}
