var plugin = require('../lib');

function main() {
  var targetFile = process.argv[2];

  console.log('Inspecting ', './' + targetFile);
  plugin.inspect('.', targetFile).then(function(result) {
    console.log('\ninspect results:\n\n', JSON.stringify(result, null, 2));
  });

};

main();