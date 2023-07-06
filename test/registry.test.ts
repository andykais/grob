import { test } from './tools/test.ts'
import { path, fs } from './tools/deps.ts'
import { GrobberRegistry } from '../src/grobber_registry.ts'


test('grobber registry', async t => {
  const grobbers = new GrobberRegistry({ download_folder: t.artifacts_folder })

  await grobbers.register('./examples/imgur.com/grob.yml')
  // await grobbers.register('https://git.com/examples/imgur.com/grob.yml')

  const image_file_fixture = await Deno.readFile('./test/fixtures/i.imgur.com/ppUDAuk.jpeg')
  t.assert.fetch({
    request: { url: 'https://imgur.com/gallery/NTwmL' },
    response: { body: await Deno.readTextFile('./test/fixtures/imgur.com/gallery.html') }
  })

  t.assert.fetch({
    request: { url: 'https://i.imgur.com/ppUDAuk.jpeg' },
    response: { body: image_file_fixture }
  })

  // TODO in the future, we may need more than one input (e.g. username + session cookie)
  // those may end up being secondary variable inputs though grobbers.start('https://instagram.com/myusername', { session_cookie: 'abc'})
  // I still like the idea of a string regex matcher
  await grobbers.start('https://imgur.com/gallery/NTwmL')

  let image_file
  let gallery_data
  const files: fs.WalkEntry[] = []
  for await (const file of fs.walk(path.join(t.artifacts_folder, 'imgur_gallery'))) {
    if (!file.isFile) continue
    if (file.name === 'ppUDAuk.jpeg') image_file = await Deno.readFile(file.path)
    if (file.name === 'gallery_data.json') gallery_data = JSON.parse(await Deno.readTextFile(file.path))
    files.push(file)
  }
  t.assert.equals(files.length, 3)
  t.assert.equals(image_file, image_file_fixture)
  t.assert.equals(gallery_data.title, `"What do you mean you don't know what that is?!"`)
  t.assert.equals(gallery_data.media.length, 1)
})
