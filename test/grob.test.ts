import { Grob } from '../mod.ts'
import { path } from './tools/deps.ts'
import { test } from './tools/test.ts'


test('grob basic cached', async t => {
  const grob = new Grob({ download_folder: t.artifacts_folder })
  t.assert.fetch({
    request: {
      url: 'https://search.brave.com'
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
  t.assert.fetch_mock_not_found(() => grob.fetch_text('https://search.brave.com/foo'))
  // failures like this will not get stored in the peristent db
  t.assert.fetch_mock_not_found(() => grob.fetch_text('https://search.brave.com/foo'))

  t.assert.fetch({
    request: {
      url: 'https://search.brave.com',
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

  grob.close()
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
      url: 'https://search.brave.com',
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

  t.assert.fetch({ request: { url: 'https://example.com' }, response: { body: 'foo' } })
  t.assert.fetch({ request: { url: 'https://example.com' }, response: { body: 'bar' } })
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
    request: { url: 'https://search.brave.com' },
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

  t.assert.fetch({ request: { url: 'https://example.com' }, response: { body: 'foo' } })

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
