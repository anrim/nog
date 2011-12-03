var Http = require('http'),
    Stack = require('stack'),
    Creationix = require('creationix'),
    createDB = require('jsondb'),
    Corn = require('corn');

var port = process.env.PORT || 8080;

Http.createServer(Stack(
  Creationix.log(),
  Creationix.route("GET", "/", function (req, res, params, next) {
    render("frontindex", {
      title: "This is the title",
      articles: [{title:"My first",author:{name:"Tim Caswell"}}],
    }, function (err, html) {
      if (err) return next(err);
      res.writeHead(200, {
        "Content-Length": Buffer.byteLength(html),
        "Content-Type": "text/html; charset=utf-8"
      });
      res.end(html);
    });
  })
)).listen(port);

console.log("Server listening at http://localhost:%s/", port);

var FS = require('fs');
var Path = require('path');
var templateDir = Path.join(__dirname, "templates");

function render(name, data, callback) {
  data.__proto__ = Corn.helpers;
  compile(name, function (err, template) {
    if (err) return callback(err);
    template(data, callback);
  });
}

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

Corn.helpers = {
  partial: render,
  loop: function (name, array, callback) {
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
  },
};
