const fs = require('fs')
const path = require('path')

const { runJSFile } = require('./runJSFile')

const { logger } = require('../utils')
const clog = new logger({ head: 'anyRule' })

function getUserAgent() {
  let uagent = {}
  if (fs.existsSync(path.join(__dirname, 'Lists', "useragent.list"))) {
    try {
      uagent = JSON.parse(fs.readFileSync(path.join(__dirname, 'Lists', "useragent.list"), "utf8"))
    } catch(e) {
      clog.error('User-Agent 获取失败')
    }
  }
  return { uagent }
}

function getRewriteList() {
  let subrules = []
  let rewritelists = []
  if (fs.existsSync(path.join(__dirname, 'Lists', 'rewrite.list'))) {
    fs.readFileSync(path.join(__dirname, 'Lists', 'rewrite.list'), 'utf8').split(/\r|\n/).forEach(l=>{
      if (/^(#|\[)/.test(l) || l.length<2) return
      let item = l.split(" ")
      if (item.length == 2) {
        if (/^sub/.test(item[0])) {
          subrules.push(item[1])
        } else if (/js$/.test(item[1])) {
          rewritelists.push([item[0], item[1]])
        }
      }
    })
  }

  return { subrules, rewritelists }
}

function getRulesList(){
  let reqlists = []
  let reslists = []
  if (fs.existsSync(path.join(__dirname, 'Lists', 'default.list'))) {
    fs.readFileSync(path.join(__dirname, 'Lists', 'default.list'), 'utf8').split(/\n|\r/).forEach(l=>{
      if (l.length<=8 || /^(#|\[)/.test(l)) return
      let item = l.split(",")
      if (item.length >= 4) {
        item = item.map(i=>i.trim())
        if (item[4] == "req") reqlists.push(item)
        else reslists.push(item)
      }
    })
  }
  return { reqlists, reslists }
}

function getMitmhost() {
  let mitmhost = []
  if (fs.existsSync(path.join(__dirname, 'Lists', 'mitmhost.list'))) {
    mitmhost = fs.readFileSync(path.join(__dirname, 'Lists', 'mitmhost.list'), 'utf8').split(/\r|\n/).filter(host=>{
      if (/^(\[|#|;)/.test(host) || host.length < 3) {
        return false
      }
      return true
    })
  }
  return { mitmhost }
}

function init(){
  if (!fs.existsSync(path.join(__dirname, 'Lists'))) {
    fs.mkdirSync(path.join(__dirname, 'Lists'))
    clog.notify('暂无规则，新建 Lists 文件夹')
    return {}
  }

  let config = {
      mitmtype: 'list',
      ...getRulesList(),
      ...getRewriteList(),
      ...getMitmhost(),
      ...getUserAgent()
    }

  clog.notify(`default 规则 ${ config.reqlists.length + config.reslists.length } 条`)
  clog.notify(`rewrite 规则 ${ config.rewritelists.length } 条`)
  clog.notify(`MITM hosts ${ config.mitmhost.length } 个`)

  return config
}

const CONFIG_RULE = init()

const localResponse = {
  reject: {
    statusCode: 200,
    header: { 'Content-Type': 'text/plain' },
    body: ''
  },
  imghtml: {
    statusCode: 200,
    header: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<img src="data:image/png;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt="elecV2P"/>'
  },
  json: {
    statusCode: 200,
    header: { 'Content-Type': 'application/json' },
    body: '{"data": "elecV2P"}'
  },
  tinyimg: {
    statusCode: 200,
    header: { 'Content-Type': 'image/png' },
    body: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')
  }
}

function getrules($request, $response, lists) {
  const $req = $request.requestOptions

  const urlObj = new URL($request.url)
  let matchstr = {
    ip: urlObj.hostname,
    url: $request.url,
    host: urlObj.hostname,
    reqmethod: $req.method,
    reqbody: $request.requestData,
    useragent: $req.headers["User-Agent"],
    resstatus: $response?$response.statusCode:"",
    restype: $response?$response.header["Content-Type"]:"",
    resbody: $response?$response.body:""
  }
  return lists.filter(l=>{ return (new RegExp(l[1])).test(matchstr[l[0]]) })
}

function formBody(body) {
  return typeof(body) == 'object' ? (Buffer.isBuffer(body) ? body.toString() : JSON.stringify(body)) : body
}

function formRequest($request) {
  return {
    ...$request.requestOptions,
    url: $request.url,
    body: formBody($request.requestData),
  }
}

function formResponse($response) {
  return {
    ...$response,
    body: formBody($response.body)
  }
}

module.exports = {
  summary: 'elecV2P - customize personal network',
  init,
  CONFIG_RULE,
  *beforeSendRequest(requestDetail) {
    let getr = getrules(requestDetail, null, CONFIG_RULE.reqlists)
    if(getr.length) clog.info("reqlists:", getr.length)
    for(let r of getr) {
      if ("block" === r[2]) {
        clog.info("block - " + r[3])
        return { response: localResponse[r[3]] }
      }
      if (/^301$|^302$|^307$/.test(r[2])) {
        clog.info(r[2] + "重定向至 " + r[3])
        return {
          response: {
            statusCode: r[2],
            header: {Location: r[3]}
          }
        }
      }
      if ("ua" == r[2]) {
        const newreqOptions = requestDetail.requestOptions
        newreqOptions.headers['User-Agent'] = CONFIG_RULE.uagent[r[3]].header
        clog.info("User-Agent 设置为：" + r[3])
        return {
          requestOptions: newreqOptions
        }
      }
      // 通过 JS 文件修改请求体
      let jsres = runJSFile(r[3], { $request: formRequest(requestDetail) })
      if (jsres.response) {
        // 直接返回结果，不访问目标网址
        clog.notify('返回结果:', jsres.response)
        return { 
          response: Object.assign(localResponse.reject, jsres.response) 
        }
      }
      // 请求信息修改
      let newreqOptions = requestDetail.requestOptions
      if (jsres["User-Agent"]) {
        clog.info("User-Agent 设置为: " + jsres["User-Agent"])
        newreqOptions.headers["User-Agent"] = jsres["User-Agent"]
      } else if (jsres.body) {
        clog.info("body changed")
        requestDetail.requestData = jsres.body
      } else {
        Object.assign(newreqOptions, jsres)
      }
    }
    return requestDetail
  },
  *beforeSendResponse(requestDetail, responseDetail) {
    const $request = requestDetail
    const $response = responseDetail.response

    for (let r of CONFIG_RULE.rewritelists) {
      if ((new RegExp(r[0])).test($request.url)) {
        clog.info('rewrite rule:', r[0], r[1])
        let jsres = runJSFile(r[1], { $request: formRequest($request), $response: formResponse($response) })
        Object.assign($response, jsres ? (jsres.response ? jsres.response : jsres) : {})
        break
      }
    }

    let getr = getrules($request, $response, CONFIG_RULE.reslists)
    if(getr.length) clog.info("reslists:", getr.length)
    for(let r of getr) {
      if (r[2] == "js" || r[2] == 404) {
        let jsres = runJSFile(r[3], { $request: formRequest($request), $response: formResponse($response) })
        Object.assign($response, jsres ? (jsres.response ? jsres.response : jsres) : {})
      }
    }

    return { response: $response }
  },
  *beforeDealHttpsRequest(requestDetail) {
    if (CONFIG_RULE.mitmtype === 'all') return true
    if (CONFIG_RULE.mitmtype === 'none') return false
    
    let host = requestDetail.host.split(":")[0]
    if (CONFIG_RULE.mitmhost.indexOf(host) !== -1) {
      return true
    } else {
      return (CONFIG_RULE.mitmhost.filter(h=>(/^\*/.test(h) && new RegExp('.' + h + '$').test(host))).length ? true : false)
    }
  }
}