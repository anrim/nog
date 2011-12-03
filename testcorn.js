var Corn = require('corn');
var FS = require('fs');

var source = FS.readFileSync(__dirname + "/templates/frontindex.html", 'utf8');

var template = Corn(source);

console.log(template.toString());

template({
  title: "This is the title",
  partial: function (name, data, callback) { return name + ": " + JSON.stringify(data) },
  loop: function (name, array, callback) { return name + ": " + JSON.stringify(array) },
  articles: [{title:"My first",author:{name:"Tim Caswell"}}],
}, function (err, html) {
  if (err) throw err;
  console.log(html);
});
