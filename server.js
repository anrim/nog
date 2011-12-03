var Http = require('http'),
    Stack = require('stack'),
    Creationix = require('creationix'),
    createDB = require('jsondb'),
    Corn = require('corn');

var port = process.env.PORT || 8080;

Http.createServer(Stack(
  Creationix.log(),
  Creationix.route("GET", "/", function (req, res, params, next) {
    renderIndex(function (err, html) {
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

function compile(name, callback) {
  FS.readFile(Path.join(templateDir, name + ".html"), "utf8", function (err, source) {
    if (err) return callback(err);
    try {
      var template = Corn(source);
//      console.log(template.toString());
    } catch (err) {
      return callback(err);
    }
    callback(null, template);
  });
}

Corn.helpers = {
  partial: function (callback) {
//    console.dir({partial:arguments})
    process.nextTick(function () {
      callback(null, "*PARTIAL*");
    });
  },
  loop: function (callback) {
//    console.dir({loop:arguments});  
    process.nextTick(function () {
      callback(null, "*LOOP*");
    });
  },
};

function renderIndex(callback) {
  compile("frontindex", function(err, template) {
    if (err) return callback(err);
    template({
      title: "This is the title",
      articles: [{name:"My first"}],
    }, callback);
  });
}
