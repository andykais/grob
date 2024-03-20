import { Grob } from '../mod.ts'
import { path } from './tools/deps.ts'
import { test, FetchMockNotFound } from './tools/test.ts'


test('grob basic cached', async t => {
  using grob = new Grob({ download_folder: t.artifacts_folder })

  t.assert.fetch({
    request: {
      url: 'https://search.brave.com/'
    },
    response: {
      body: 'yo',
      status_code: 200
    }
  })

  const text_1 = await grob.fetch_text('https://search.brave.com')
  t.assert.equals(text_1, 'yo')

  // this response is cached
  const text_2 = await grob.fetch_text('https://search.brave.com')
  t.assert.equals(text_2, 'yo')

  // this response has no mock set up
  await t.assert.rejects(() => grob.fetch_text('https://search.brave.com/foo'), FetchMockNotFound)
  // failures like this will not get stored in the peristent db
  await t.assert.rejects(() => grob.fetch_text('https://search.brave.com/foo'), FetchMockNotFound)

  t.assert.fetch({
    request: {
      url: 'https://search.brave.com/',
      headers: {'accept': 'json'}
    },
    response: {
      body: JSON.stringify({hello: 'world'})
    }
  })
  // this response does not use the same peristent request because the headers are part of the db query
  const json_1 = await grob.fetch_json('https://search.brave.com', { headers: {'accept': 'json'} })
  t.assert.equals(json_1, { hello: 'world' })
  // this response is cached
  const json_2 = await grob.fetch_json('https://search.brave.com', { headers: {'accept': 'json'} })
  t.assert.equals(json_2, { hello: 'world' })
})

test('grob file cache', async t => {
  const grob = new Grob({ download_folder: t.artifacts_folder })

  t.assert.fetch({
    request: {
      url: 'https://search.brave.com/index.html'
    },
    response: {
      body: 'save to file please',
    }
  })

  const filepath_1 = await grob.fetch_file('https://search.brave.com/index.html')
  await t.assert.file_contents(filepath_1, 'save to file please')
  t.assert.equals(path.basename(filepath_1), 'index.html')
  // this response is cached
  const filepath_2 = await grob.fetch_file('https://search.brave.com/index.html')
  await t.assert.file_contents(filepath_2, 'save to file please')

  grob.close()
})

test('grob file folder prefix', async t => {
  const grob = new Grob({ download_folder: t.artifacts_folder })

  t.assert.fetch({
    request: {
      url: 'https://search.brave.com/index.html'
    },
    response: {
      body: 'save to file please',
    }
  })

  const filepath = await grob.fetch_file('https://search.brave.com/index.html', {}, { folder_prefix: 'foobar-'})
  await t.assert.file_contents(filepath, 'save to file please')
  t.assert.equals(path.basename(filepath), 'index.html')
  t.assert.equals(path.basename(path.dirname(filepath)).startsWith('foobar-'), true)

  grob.close()
})

test('grob cookies', async t => {
  const grob = new Grob({ download_folder: t.artifacts_folder })

  t.assert.fetch({
    request: {
      url: 'https://search.brave.com/',
    },
    response: {
      body: 'save to file please',
      headers: {
        'content-type': 'text/plain',
        'set-cookie': 'sticky=foo; Domain=search.brave.com',
      }
    }
  })
  const cookies_1 = await grob.fetch_cookies('https://search.brave.com')
  t.assert.equals(cookies_1.length, 1)
  t.assert.equals(cookies_1[0], { name: 'sticky', value: 'foo', domain: 'search.brave.com' })

  const headers_1 = await grob.fetch_headers('https://search.brave.com')
  t.assert.equals(headers_1.get('content-type'), 'text/plain')
  t.assert.equals(headers_1.get('set-cookie'), 'sticky=foo; Domain=search.brave.com')

  grob.close()
})

test('grob cache ttl', async t => {
  t.fake_time.setup()

  const grob = new Grob({ download_folder: t.artifacts_folder })

  t.assert.fetch({ request: { url: 'https://example.com/' }, response: { body: 'foo' } })
  t.assert.fetch({ request: { url: 'https://example.com/' }, response: { body: 'bar' } })
  const expires_on = new Date()
  expires_on.setDate(expires_on.getDate() + 1)
  const response_1 = await grob.fetch_text('https://example.com', {}, { expires_on })
  t.assert.equals(response_1, 'foo')
  // second response is cached
  const response_2 = await grob.fetch_text('https://example.com', {}, { expires_on })
  t.assert.equals(response_2, 'foo')

  // advancing the time by 25 hours should mean we no longer look at the cached value
  t.fake_time.tick(25 * 1000 * 60 * 60)
  const response_3 = await grob.fetch_text('https://example.com')
  t.assert.equals(response_3, 'bar')

  grob.close()
})

test('grob html', async t => {
  const grob = new Grob({ download_folder: t.artifacts_folder })

  t.assert.fetch({
    request: { url: 'https://search.brave.com/' },
    response: {
      body: `<html>
      <body>
        <span class="title">brave search engine</span>
        <span class="description">it searches for stuff</span>

        <div class='searchresults'>
          <div class='searchresult'>
            <a href='https://mysite.com'>My Site</a>
            <span class='blurb'>My Site contains info</span>
          </div>
          <div class='searchresult'>
            <a href='https://myblog.com'>My Blog</a>
            <span class='blurb'>My Blog contains blog entries</span>
          </div>
        </div>

        <a class='homelink' href="https://brave.com">brave.com</a>
      </body>
      </html>`
    }
  })

  const index_html = await grob.fetch_html('https://search.brave.com')
  t.assert.equals(index_html.select_one('span.title')?.text(), 'brave search engine')
  t.assert.equals(index_html.select_one('a.homelink')?.attr('href'), 'https://brave.com')
  const search_results = index_html.select_all('.searchresult').map(node => ({
    link: node.select_one('a')?.attr('href'),
    blurb: node.select_one('span.blurb')?.text(),
  }))
  t.assert.equals(search_results, [
    {link: 'https://mysite.com', blurb: 'My Site contains info'},
    {link: 'https://myblog.com', blurb: 'My Blog contains blog entries'},
  ])


  grob.close()
})

test('grob grob_options.ignore.headers', async t => {
  const grob = new Grob({ download_folder: t.artifacts_folder })

  t.assert.fetch({ request: { url: 'https://example.com/' }, response: { body: 'foo' } })

  const response_1 = await grob.fetch_text('https://example.com', {
    headers: {
      'cookie': 'x-csrf-token=abc123'
    }
  }, {
    ignore: {
      headers: ['cookie']
    }
  })
  t.assert.equals(response_1, 'foo')

  // second response is cached
  const response_2 = await grob.fetch_text('https://example.com', {
    headers: {
      'cookie': 'x-csrf-token=def567'
    }
  }, {
    ignore: {
      headers: ['cookie']
    }
  })
  t.assert.equals(response_2, 'foo')


  grob.close()

})

test('grob validate response.status', async t => {
  const grob = new Grob({ download_folder: t.artifacts_folder })

  const expectation = t.assert.fetch({ request: { url: 'https://example.com/' }, response: { status_code: 500, body: 'Internal server error' } })
  await t.assert.rejects(() => grob.fetch_text('https://example.com', {}, {validate: { status: [200] }}))

  t.assert.fetch({ request: { url: 'https://example.com/' }, response: { status_code: 200, body: '<html></html>' } })
  // TODO this is broken currently because it returns the 500 response. the 'proper' workflow here involves a way to remove/invalidate old requests. This is what the @retry decorator will do
  // const response = await grob.fetch_text('https://example.com', {}, {validate: { status: [200] }})
  const response = await grob.fetch_text('https://example.com', {}, {validate: { status: [200] }, cache: false })
  t.assert.equals(response, '<html></html>')

  grob.close()
})

test('grob parallel fetch_file', async t => {
  using grob = new Grob({ download_folder: t.artifacts_folder })
  const fetch_controller = Promise.withResolvers<Response>()

  t.assert.fetch({ request: { url: 'https://s3.com/myfile' }, response: fetch_controller.promise })

  // this first request does a normal network request
  const filepath_1_promise = grob.fetch_file('https://s3.com/myfile')
  await new Promise(resolve => setTimeout(resolve, 100))
  // this second response should hit the runtime cache
  const filepath_2_promise = grob.fetch_file('https://s3.com/myfile')

  fetch_controller.resolve(new Response('foobar'))
  const filepath_1 = await filepath_1_promise
  await t.assert.file_contents(filepath_1, 'foobar')
  const filepath_2 = await filepath_2_promise
  await t.assert.file_contents(filepath_2, 'foobar')
  // NOTE this may change in the future, this is just an assertion of the existing behavior
  // (e.g. if there is a cache hit on fetch_file, we will return the existing filepath, not copy the file to a new path)
  t.assert.equals(filepath_1, filepath_2)
})

test.skip('grob parallel fetch_file with explicit filepath', async t => {
  using grob = new Grob({ download_folder: t.artifacts_folder })
  const fetch_controller = Promise.withResolvers<Response>()

  t.assert.fetch({ request: { url: 'https://s3.com/myfile' }, response: fetch_controller.promise })

  // this first request does a normal network request
  const filepath_1_promise = grob.fetch_file('https://s3.com/myfile')
  t.assert.equals(grob.stats.cache.count, 0)
  t.assert.equals(grob.stats.fetch.count, 1)
  // this second response should hit the runtime cache
  const fetch_file_2_filepath = path.join(t.artifacts_folder, 'some', 'custom', 'path')
  const filepath_2_promise = grob.fetch_file('https://s3.com/myfile', {}, { filepath: fetch_file_2_filepath })

  fetch_controller.resolve(new Response('foobar'))
  // await t.assert.rejects(() => filepath_2_promise)

  const filepath_1 = await filepath_1_promise
  const filepath_2 = await filepath_2_promise
  await t.assert.file_contents(filepath_1, 'foobar')
  await t.assert.file_contents(filepath_2, 'foobar')

  // assert the file was actually copied to a different destination
  t.assert.not_equals(filepath_1, filepath_2)
  // assert the filepath is what we explicitly asked for
  t.assert.equals(filepath_2, fetch_file_2_filepath)

  t.assert.equals(grob.stats.cache.count, 1)
  t.assert.equals(grob.stats.fetch.count, 1)
})

test('test Grob::content-length()', async t => {
  using grob = new Grob({ download_folder: t.artifacts_folder })

  const response_body_garbage_data = new Array(4000).fill(0).join('')
  // const response_body_garbage_data = 'foobar'
  const content_length = (new TextEncoder().encode(response_body_garbage_data)).length
  // t.assert.fetch({ request: { url: 'http://localhost:4000/foobar' }, response: { headers: {'content-length': content_length.toString()}, body: response_body_garbage_data },  })
  t.assert.fetch({
    request: {
      url: 'https://search.brave.com/',
    },
    response: {
      body: response_body_garbage_data,
      headers: { 'content-length': content_length.toString() },
      status_code: 200,
    },
  })

  await grob.fetch_text('https://search.brave.com')
  t.assert.equals(grob.stats.fetch, { count: 1, total_bytes: 4000})
  t.assert.equals(grob.stats.cache, { count: 0, total_bytes: 0})

  await grob.fetch_text('https://search.brave.com')
  t.assert.equals(grob.stats.fetch, { count: 1, total_bytes: 4000})
  t.assert.equals(grob.stats.cache, { count: 1, total_bytes: 4000})

  await grob.fetch_text('https://search.brave.com')
  t.assert.equals(grob.stats.fetch, { count: 1, total_bytes: 4000})
  t.assert.equals(grob.stats.cache, { count: 2, total_bytes: 8000})

  const response_body_garbage_data_2 = new Array(5000).fill(1).join('')
  const content_length_2 = (new TextEncoder().encode(response_body_garbage_data_2)).length
  t.assert.fetch({
    request: {
      url: 'https://search.brave.com/myfile',
    },
    response: {
      body: response_body_garbage_data_2,
      headers: { 'content-length': content_length_2.toString() },
      status_code: 200,
    },
  })

  await grob.fetch_file('https://search.brave.com/myfile')
  t.assert.equals(grob.stats.fetch, { count: 2, total_bytes: 9000})
  t.assert.equals(grob.stats.cache, { count: 2, total_bytes: 8000})
})
