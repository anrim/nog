module.exports = Queue;
function Queue() {
  this.tail = [];
  this.head = [];
  this.offset = 0;
}

Queue.prototype.shift = function () {
  if (this.offset === this.head.length) {
    var tmp = this.head;
    tmp.length = 0;
    this.head = this.tail;
    this.tail = tmp;
    this.offset = 0;
    if (this.head.length === 0) {
      return;
    }
  }
  return this.head[this.offset++]; // sorry, JSLint
};

Queue.prototype.push = function (item) {
  return this.tail.push(item);
};

Object.defineProperty(Queue.prototype, "length", {
  get: function () {
    return this.head.length - this.offset + this.tail.length;
  }
});

