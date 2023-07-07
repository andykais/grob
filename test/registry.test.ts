import { test } from './tools/test.ts'
import { path, fs, file_server } from './tools/deps.ts'
import { GrobberRegistry, type GrobberDefinition } from '../mod.ts'


test('grobber registry', async t => {
  const grobbers = new GrobberRegistry({ download_folder: t.artifacts_folder })

  // await grobbers.register('./examples/imgur.com/grob.yml')
  await grobbers.register('../grob/examples/imgur.com/grob.yml')
  // await grobbers.register('https://git.com/examples/imgur.com/grob.yml')

  const image_file_fixture = await Deno.readFile(path.join(t.fixtures_folder, '/files/i.imgur.com/ppUDAuk.jpeg'))
  t.assert.fetch({
    request: { url: 'https://imgur.com/gallery/NTwmL' },
    response: { body: await Deno.readTextFile(path.join(t.fixtures_folder, '/files/imgur.com/gallery.html')) }
  })

  t.assert.fetch({
    request: { url: 'https://i.imgur.com/ppUDAuk.jpeg' },
    response: { body: image_file_fixture }
  })

  // NOTE in the future, we may need more than one input (e.g. username + session cookie)
  // those may end up being secondary variable inputs though grobbers.start('https://instagram.com/myusername', { session_cookie: 'abc'})
  // I still like the idea of a string regex matcher
  await grobbers.start('https://imgur.com/gallery/NTwmL', { [Symbol.for('accept_fetch')]: true })

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

  grobbers.close()
})

test('grobber registry remote grob.yml', async t => {
  const grobbers = new GrobberRegistry({ download_folder: t.artifacts_folder })

  // lets simulate a remote grob.yml file, which will have a relative program file that needs to be fetched as well
  const grob_yml_fetch = t.assert.fetch({
    request: { url: 'https://raw.githubusercontent.com/andykais/grob/imgur.com/grob.yml'},
    response: { body: await Deno.readTextFile('./examples/imgur.com/grob.yml') }
  })
  const program_fetch = t.assert.fetch({
    request: { url: 'https://raw.githubusercontent.com/andykais/grob/imgur.com/gallery.ts'},
    response: { body: await Deno.readTextFile('./examples/imgur.com/gallery.ts') }
  })

  await grobbers.register('https://raw.githubusercontent.com/andykais/grob/imgur.com/grob.yml')
  t.assert.equals(grob_yml_fetch.status, 'FULFILLED')
  t.assert.equals(program_fetch.status, 'FULFILLED')

  t.assert.fetch({
    request: { url: 'https://imgur.com/gallery/NTwmL' },
    response: { body: await Deno.readTextFile(path.join(t.fixtures_folder, '/files/imgur.com/gallery.html')) }
  })

  t.assert.fetch({
    request: { url: 'https://i.imgur.com/ppUDAuk.jpeg' },
    response: { body: await Deno.readFile(path.join(t.fixtures_folder, '/files/i.imgur.com/ppUDAuk.jpeg')) }
  })

  await grobbers.start('https://imgur.com/gallery/NTwmL', { [Symbol.for('accept_fetch')]: true })

  // TODO use subtests for cached/invalid registries. Currently not possible due to a deno bug https://github.com/denoland/deno/issues/19750

  // grabbing an existing grob.yml should be cached by default
  await grobbers.register('https://raw.githubusercontent.com/andykais/grob/imgur.com/grob.yml')

  // no two grob.yml files can share the same name
  t.assert.rejects(() =>
    grobbers.register(path.join(t.fixtures_folder, 'imgur_duplicate', 'grob.yml'))
  )

  grobbers.close()
})
