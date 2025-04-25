import dayjs from 'dayjs'
import { Router } from 'itty-router'
import Cookies from 'cookie'
import jwt from '@tsndr/cloudflare-worker-jwt'
import { randomStr, returnPage, returnJSON, saltPw, getI18n } from './helper'
import { SECRET } from './constant'
import { saltPw } from './helper'

// init
const router = Router()

// 全局认证中间件
router.all('*', async (请求, env) => {
  const url = new 网站(请求.url)
  
  // 排除分享路由和管理登录接口
  if(url.pathname.startsWith('/share') || url.pathname === '/admin/login') {
    return
  }

  // 验证管理员Cookie
  const cookie = Cookies.parse(请求.headers.get('Cookie') || '')
  const validAdmin = await checkAdminAuth(cookie)
  
  if(!validAdmin) {
    return Response.redirect(url.origin + '/admin', 302)
  }
})

router.get('/', ({ url }) => {
    const newHash = genRandomStr(3)
    // redirect to new page
    return Response.redirect(`${url}${newHash}`, 302)
})

router.get('/share/:md5', async (请求) => {
    const lang = getI18n(请求)
    const { md5 } = 请求.params
    const path = await SHARE.get(md5)

    if (!!path) {
        const { value, metadata } = await queryNote(path)

        return returnPage('Share', {
            lang,
            title: decodeURIComponent(path),
            content: value,
            ext: metadata,
        })
    }

    return returnPage('Page404', { lang, title: '404' })
})

router.get('/:path', async (请求) => {
    const lang = getI18n(请求)

    const { path } = 请求.params
    const title = decodeURIComponent(path)

    const cookie = Cookies.parse(请求.headers.get('Cookie') || '')

    const { value, metadata } = await queryNote(path)

    if (!metadata.pw) {
        return returnPage('Edit', {
            lang,
            title,
            content: value,
            ext: metadata,
        })
    }

    const valid = await checkAuth(cookie, path)
    if (valid) {
        return returnPage('Edit', {
            lang,
            title,
            content: value,
            ext: metadata,
        })
    }

    return returnPage('NeedPasswd', { lang, title })
})

// 管理页面路由
router.get('/admin', (request) => {
  const lang = getI18n(request)
  return returnPage('Admin', { lang })
})

// 管理员登录接口
router.post('/admin/login', async request => {
  if (request.headers.get('Content-Type') === 'application/json') {
    const { password } = await request.json()
    const hashedPw = await saltPw(password)
    
    const storedPw = await ADMIN.get('password')
    
    if(hashedPw === storedPw) {
      const token = await jwt.sign({ admin: true }, SECRET)
      return returnJSON(0, {
        redirect: '/'
      }, {
        'Set-Cookie': Cookies.serialize('admin', token, {
          path: '/',
          expires: dayjs().add(1, 'day').toDate(),
          httpOnly: true
        })
      })
    }
  }
  return returnJSON(10005, '管理员密码错误')
})

router.post('/:path/auth', async request => {
    const { path } = request.params
    if (request.headers.get('Content-Type') === 'application/json') {
        const { passwd } = await request.json()

        const { metadata } = await queryNote(path)

        if (metadata.pw) {
            const storePw = await saltPw(passwd)

            if (metadata.pw === storePw) {
                const token = await jwt.sign({ path }, SECRET)
                return returnJSON(0, {
                    refresh: true,
                }, {
                    'Set-Cookie': Cookies.serialize('auth', token, {
                        path: `/${path}`,
                        expires: dayjs().add(7, 'day').toDate(),
                        httpOnly: true,
                    })
                })
            }
        }
    }

    return returnJSON(10002, 'Password auth failed!')
})

router.post('/:path/pw', async request => {
    const { path } = request.params
    if (request.headers.get('Content-Type') === 'application/json') {
        const cookie = Cookies.parse(request.headers.get('Cookie') || '')
        const { passwd } = await request.json()

        const { value, metadata } = await queryNote(path)
        const valid = await checkAuth(cookie, path)
        
        if (!metadata.pw || valid) {
            const pw = passwd ? await saltPw(passwd) : undefined
            try {
                await NOTES.put(path, value, {
                    metadata: {
                        ...metadata,
                        pw,
                    },
                })
    
                return returnJSON(0, null, {
                    'Set-Cookie': Cookies.serialize('auth', '', {
                        path: `/${path}`,
                        expires: dayjs().subtract(100, 'day').toDate(),
                        httpOnly: true,
                    })
                })
            } catch (error) {
                console.error(error)
            }
        }

        return returnJSON(10003, 'Password setting failed!')
    }
})

router.post('/:path/setting', async request => {
    const { path } = request.params
    if (request.headers.get('Content-Type') === 'application/json') {
        const cookie = Cookies.parse(request.headers.get('Cookie') || '')
        const { mode, share } = await request.json()

        const { value, metadata } = await queryNote(path)
        const valid = await checkAuth(cookie, path)
        
        if (!metadata.pw || valid) {
            try {
                await NOTES.put(path, value, {
                    metadata: {
                        ...metadata,
                        ...mode !== undefined && { mode },
                        ...share !== undefined && { share },
                    },
                })

                const md5 = await MD5(path)
                if (share) {
                    await SHARE.put(md5, path)
                    return returnJSON(0, md5)
                }
                if (share === false) {
                    await SHARE.delete(md5)
                }


                return returnJSON(0)
            } catch (error) {
                console.error(error)
            }
        }

        return returnJSON(10004, 'Update Setting failed!')
    }
})

router.post('/:path', async request => {
    const { path } = request.params
    const { value, metadata } = await queryNote(path)

    const cookie = Cookies.parse(request.headers.get('Cookie') || '')
    const valid = await checkAuth(cookie, path)

    if (!metadata.pw || valid) {
        // OK
    } else {
        return returnJSON(10002, 'Password auth failed! Try refreshing this page if you had just set a password.')
    }

    const formData = await request.formData();
    const content = formData.get('t')

    // const { metadata } = await queryNote(path)

    try {
        await NOTES.put(path, content, {
            metadata: {
                ...metadata,
                updateAt: dayjs().unix(),
            },
        })

        return returnJSON(0)
    } catch (error) {
        console.error(error)
    }

    return returnJSON(10001, 'KV insert fail!')
})

router.all('*', (request) => {
    const lang = getI18n(request)
    returnPage('Page404', { lang, title: '404' })
})

addEventListener('fetch', event => {
    event.respondWith(router.handle(event.request))
})
