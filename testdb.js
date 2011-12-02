var createDB = require('./jsondb');

var db = createDB("data");

var start = 3000;
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
        five();
      }
    });
  }
}

function five() {
  before = Date.now();
  var left = start * 3;
  console.log("%s parallel mixed", left);
  for (var i = 0; i < start; i++) {
    db.get("articles/myfirst", function (err, article) {
      if (err) throw err;
      left--;
      if (!left) {
        console.log(Math.floor(start / (Date.now() - before) * 10000)/10, "per second");
      }
    });

    db.put("articles/myfirst", article, function (err) {
      if (err) throw err;
      left--;
      if (!left) {
        console.log(Math.floor(start / (Date.now() - before) * 10000)/10, "per second");
      }
    });

    db.get("articles/myfirst", function (err, article) {
      if (err) throw err;
      left--;
      if (!left) {
        console.log(Math.floor(start / (Date.now() - before) * 30000)/10, "per second");
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
