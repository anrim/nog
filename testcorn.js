var Corn = require('corn');
var FS = require('fs');

var source = FS.readFileSync(__dirname + "/templates/frontindex.html", 'utf8');

var template = Corn(source);

console.log(template.toString());
