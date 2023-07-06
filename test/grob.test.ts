import { Grob } from '../src/grob.ts'
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

  const response_1 = await grob.fetch_file('https://search.brave.com/index.html')
  await t.assert.file_contents(response_1.filepath, 'save to file please')
  t.assert.equals(path.basename(response_1.filepath), 'index.html')
  // this response is cached
  const response_2 = await grob.fetch_file('https://search.brave.com/index.html')
  await t.assert.file_contents(response_2.filepath, 'save to file please')

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
