import * as plugin from '../lib';

function main() {
  const targetFile = process.argv[2];

  plugin
    .inspect('.', targetFile, { debug: true })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.log('Error:', error.stack);
    });
}

main();
