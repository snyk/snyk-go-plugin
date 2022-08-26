import * as plugin from "../lib";
import * as path from 'path';

function chdirToPkg(pkgPathArray) {
    const goPath = 'GOPATH'
    process.env[goPath] = path.resolve(__dirname, 'fixtures', 'gopath');
    process.chdir(
      // use apply() instead of the spread `...` operator to support node v4
      path.resolve.apply(
        null,
        [__dirname, 'fixtures', 'gopath', 'src'].concat(pkgPathArray)
      )
    );
      }

describe("go-path", () => {
  it("Should work when everything is fine", async () => {
    chdirToPkg(['path', 'to', 'pkg']);

    const result = await plugin.inspect('.', 'Gopkg.lock')

    console.log(process.env['GOPATH'], 'what is the gopath anyway')
    expect(result).toBeTruthy();


  });

//   it("Should throw error when Go is not installed", async () => {
//     const goPath = ''
//     process.env[goPath] = path.resolve(__dirname, 'fixtures', 'gopath');
//     chdirToPkg(['path', 'to', 'pkg']);

//     const result = await plugin.inspect('.', 'Gopkg.lock')

//     expect(result).toThrowError('Go is not available on the system');


//   });
})