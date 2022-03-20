// deno.land/std
import * as path from 'https://deno.land/std@0.127.0/path/mod.ts'
import { getCookies } from "https://deno.land/std@0.127.0/http/cookie.ts";
// deno.land/x/
import { cheerio } from "https://deno.land/x/cheerio@1.0.4/mod.ts";
// local
import { Grob } from './grob.ts'

function parse_resonse_cookies(response: Response) {
  const cookies: {[key:string]: string} = {}
  for (const [key, value] of response.headers.entries()) {
    if (key === 'set-cookie') {
      const kv_pairs = value
        .split(/;[ ]*/)
        .map(cookie_str => {
          return cookie_str.split('=', 2)
        })
      Object.assign(cookies, Object.fromEntries(kv_pairs))
    }
  }
  return cookies
}

interface ApiFeedCreator {
  id: string
  nick: string
  profileUrl: string
  avatar: {
    url: string
  }
}
interface ApiFeedItem {
  id: string
  created: number
  captionBottomText: string
  captionText: string
  comments: number
  description: string
  title: string
  link: string
  published: number
  republished: number
  smiles: number
  // media url
  url: string
  creator: ApiFeedCreator
  source: ApiFeedCreator
  tags: string[]
}

interface ApiFeed {
  items: ApiFeedItem[]
  pagination: {
    next: string
    hasNext: boolean
  }
}

interface ApiInitialState {
  feed: ApiFeed
}


async function scrape(username: string, output_directory: string) {
  const download_directory = path.join(output_directory, username)
  await Deno.mkdir(download_directory, { recursive: true })
  const feed_folder = path.join(download_directory, 'feed')
  await Deno.mkdir(feed_folder, { recursive: true })
  const grob = new Grob(download_directory)

  // we dont use grob here because we need access to the "set-cookie" header and we dont have a good mechanism otherwise
  // also we dont intend to cache it anyways
  const index_res = await fetch(`https://ifunny.co/user/${username}`)
  const cookies = parse_resonse_cookies(index_res)
  console.log(cookies)
  const csrf_token = cookies['x-csrf-token']
  if (csrf_token === undefined) throw new Error('parsing csrf token failed.')
  const cid_token = cookies['CID']
  if (cid_token === undefined) throw new Error('parsing cid token failed.')
  const index_page = await index_res.text()

  const script_element: any = cheerio.load(index_page)('script:contains("INITIAL_STATE")').get()[0]
  const initial_state_str = script_element.children[0].data
    .replace('window.__INITIAL_STATE__=', '')
    .replace(/};.*/, '}')
  const initial_state: ApiInitialState = JSON.parse(initial_state_str)

  const stats = { page_count: 0, feed_item_count: 0}
  let feed = initial_state.feed
  while (true) {
    const pagination_cursor = feed.pagination.next

    for (const item of feed.items) {
      const feed_item_folder = path.join(feed_folder, item.id)
      const feed_item_info_file = path.join(feed_item_folder, 'info.json')
      const feed_item_media_file = path.join(feed_item_folder, 'media' + path.extname(item.url))
      await Deno.mkdir(feed_item_folder, { recursive: true })
      await Deno.writeTextFile(feed_item_info_file, JSON.stringify(item))
      await grob.fetch_file(item.url, feed_item_media_file, { cache_to_disk: true })
      stats.feed_item_count++
      console.log(`downloaded '${item.id}' ${stats.feed_item_count.toString().padStart(3)} items out of ${stats.page_count.toString().padStart(3)} pages.   ${grob.get_stats()}`)
    }

    if (feed.pagination.hasNext === false) break
    feed = await grob.fetch_json<ApiFeed>(`https://ifunny.co/api/v1/user/${username}/timeline/${pagination_cursor}`, {
      method: 'GET',
      headers: {
        "accept": "application/json",
        "feed-type": "application/json",
        "x-csrf-token": csrf_token,
        "x-requested-with": "fetch",
        "cookie": `x-csrf-token=${csrf_token}; CID=${cid_token}`,
      },
      cache_to_disk: true
    })
    stats.page_count++
  }
}

// await scrape('visibleMicasakicks', 'downloads/ifunny.co')
if (Deno.args.length !== 1 || Deno.args[0] === '--help') {
  console.error(`Usage: ifunny-scraper <username>`)
  Deno.exit(1)
}
const username = Deno.args[0]
await scrape(username, path.join(Deno.cwd(), 'downloads/ifunny.co'))
