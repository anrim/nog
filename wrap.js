// A General wrapper with cache and batch and timeouts
module.exports = function Wrap(fn) {
  var requestBatches = {};
  var requestCache = {};
  var updatePending = {};
  function wrapped(key, callback) {
    if (requestCache.hasOwnProperty(key)) {
      callback(null, requestCache[key]);
      if (updatePending[key]) return;
      updatePending[key] = true;
      fn(key, function (err, result) {
        delete updatePending[key];
        if (err) {
          console.log(err.stack);
        } else {
          requestCache[key] = result;
        }
      });
      return;
    }
    if (requestBatches.hasOwnProperty(key)) {
      requestBatches[key].push(callback);
      return;
    }
    var batch = requestBatches[key] = [callback];
    fn(key, onDone);
    function onDone(err, result) {
      if (!err) {
        requestCache[key] = result;
      }
      delete requestBatches[key];
      for (var i = 0, l = batch.length; i < l; i++) {
        batch[i].apply(null, arguments);
      }
    }
  }
  return wrapped;
};
