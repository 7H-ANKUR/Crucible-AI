"""Improve _verify_clerk_token logging: DEBUG → WARNING for all failure paths."""
content = open('apps/api/core/security.py', encoding='utf-8').read()

old = '''    except Exception as e:
        # Log at DEBUG only — failed attempts are expected (expired tokens etc.).
        # Never log the token value itself.
        logger.debug("Clerk token verification failed: %s", type(e).__name__)
        return None'''

new = '''    except Exception as e:
        # Log at WARNING so HF container logs capture the rejection reason.
        # Never log the token value itself.
        logger.warning("Clerk token verification failed: %s: %s", type(e).__name__, str(e)[:120])
        return None'''

if old in content:
    fixed = content.replace(old, new)
    open('apps/api/core/security.py', 'w', encoding='utf-8').write(fixed)
    print("Logging upgraded to WARNING")
else:
    print("ERROR: target string not found")
    idx = content.find('logger.debug("Clerk token verification')
    if idx >= 0:
        print(repr(content[idx:idx+200]))
