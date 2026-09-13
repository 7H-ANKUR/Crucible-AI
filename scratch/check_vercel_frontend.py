import re
import urllib.request

req = urllib.request.Request('https://minex-sigma.vercel.app', headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode('utf-8', errors='ignore')
        print(f'HTML length: {len(html)}')
        scripts = re.findall(r'src="([^"]+\.js)"', html)
        print(f'Scripts found: {len(scripts)}')
        for s in scripts:
            url = s if s.startswith('http') else f'https://minex-sigma.vercel.app{s}'
            try:
                with urllib.request.urlopen(url) as s_resp:
                    content = s_resp.read().decode('utf-8', errors='ignore')
                    keys = re.findall(r'pk_(?:test|live)_[a-zA-Z0-9$]+', content)
                    clerk_domains = re.findall(r'[\w\-]+\.clerk\.accounts\.dev', content)
                    api_urls = re.findall(r'https?://[^\s"\'\\]+hf\.space[^\s"\'\\]*', content)
                    if keys or clerk_domains or api_urls:
                        print(f'In {s}:')
                        if keys: print('  Clerk Keys:', set(keys))
                        if clerk_domains: print('  Clerk domains:', set(clerk_domains))
                        if api_urls: print('  API URLs:', set(api_urls))
            except Exception:
                pass
except Exception as e:
    print('Failed to fetch:', e)
