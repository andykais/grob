import { test } from './tools/test.ts'
import { path, fs, file_server } from './tools/deps.ts'
import { GrobberRegistry, InvalidPermissions, type GrobberDefinition } from '../mod.ts'


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

// this test is likely to get removed. We now do an actual dynamic import, rather than a fetch and then dynamic import
test.skip('grobber registry remote grob.yml', async t => {
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

test('grobber registry permissions', async t => {
  const grobbers = new GrobberRegistry({ download_folder: t.artifacts_folder })

  await grobbers.register(path.join(t.fixtures_folder, 'grobbers', 'invalid_permissions', 'grob.yml'))

  const example_fetch = t.assert.fetch({
    request: { url: 'https://example.com/'},
    response: { body: `<html></html>` }
  })
  await t.assert.rejects(() => grobbers.start('https://example.com/'), InvalidPermissions)
  example_fetch.remove()

  grobbers.close()
})

test('registry remote integration server', async t => {
  t.fake_fetch.disable()

  const server_controller = new AbortController()
  const server = Deno.serve({
    handler: async (req: Request) => {
      if (req.url.includes('/static')) {
        return await file_server.serveDir(req, {
          fsRoot: path.join(t.fixtures_folder, 'grobbers', 'remote_definition'),
          urlRoot: 'static'
        })
      } else {
        return new Response('foobar')
      }
    },
    port: 9000,
    signal: server_controller.signal
  })

  const grobbers = new GrobberRegistry({ download_folder: t.artifacts_folder })
  ;(grobbers as any).force_dynamic_import_cache_reload = true
  await grobbers.register('http://localhost:9000/static/grob.yml')
  await grobbers.start('https://foo.com/?a=2&b=3')

  const contents = await Deno.readTextFile(path.join(t.artifacts_folder, 'foo.com', 'https:__foo.com_?a=2&b=3', 'add.json'))
  const data = JSON.parse(contents)
  t.assert.equals(data, { a: 2, b: 3, result: 5 })

  grobbers.close()
  server_controller.abort()
  await server.finished
})


test.only('registry multiple entrypoints', async t => {
  const grobbers = new GrobberRegistry({ download_folder: t.artifacts_folder })

  // await grobbers.register('./examples/imgur.com/grob.yml')
  await grobbers.register('../grob/examples/artstation.com/grob.yml')
  // await grobbers.register('https://git.com/examples/imgur.com/grob.yml')

  // const image_file_fixture = await Deno.readFile(path.join(t.fixtures_folder, '/files/i.imgur.com/ppUDAuk.jpeg'))
  t.assert.fetch({
    request: { url: 'https://artstation.com/dofresh' },
    response: { body: await Deno.readTextFile(path.join(t.fixtures_folder, '/files/artstation.com/dofresh.html')) }
  })
  t.assert.fetch({
    request: { url: 'https://www.artstation.com/users/dofresh/projects.json?page=1&user_id=49435'},
    response: { body: await Deno.readTextFile(path.join(t.fixtures_folder, '/files/artstation.com/projects.json?page=1&user_id=49435'))}
  })
  t.assert.fetch({
    request: { url: 'https://www.artstation.com/projects/w0yQeL.json'},
    response: { body: await Deno.readTextFile(path.join(t.fixtures_folder, '/files/artstation.com/artwork/w0yQeL.json'))}
  })

  // t.assert.fetch({
  //   request: { url: 'https://i.imgur.com/ppUDAuk.jpeg' },
  //   response: { body: image_file_fixture }
  // })

  await grobbers.start('https://artstation.com/dofresh', { [Symbol.for('accept_fetch')]: true })

//   let image_file
//   let gallery_data
//   const files: fs.WalkEntry[] = []
//   for await (const file of fs.walk(path.join(t.artifacts_folder, 'imgur_gallery'))) {
//     if (!file.isFile) continue
//     if (file.name === 'ppUDAuk.jpeg') image_file = await Deno.readFile(file.path)
//     if (file.name === 'gallery_data.json') gallery_data = JSON.parse(await Deno.readTextFile(file.path))
//     files.push(file)
//   }
//   t.assert.equals(files.length, 3)
//   t.assert.equals(image_file, image_file_fixture)
//   t.assert.equals(gallery_data.title, `"What do you mean you don't know what that is?!"`)
//   t.assert.equals(gallery_data.media.length, 1)

  grobbers.close()
})
