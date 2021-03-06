const fs = require('fs')
const path = require('path')

const { TASKS_WORKER, TASKS_INFO } = require('../func')

const { logger, nStatus, bIsUrl } = require('../utils')
const clog = new logger({ head: 'wbhook' })

const CONFIG_WBHOOK = {
  jspath: path.join(__dirname, "../runjs/JSFile"),
  logspath: path.join(__dirname, '../logs'),
}

module.exports = (app, CONFIG) => {
  app.get("/webhook", (req, res)=>{
    if (!CONFIG.wbrtoken) {
      res.end('服务器端未设置 token, 无法运行 JS')
      return
    }
    if (req.query.token !== CONFIG.wbrtoken) {
      res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' })
      res.end('token 无效')
      return
    }
    let clientip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
    clog.notify(clientip, " webhook: ", req.query.type)
    if (req.query.type === 'runjs') {
      let fn = req.query.fn
      if (!/^http(.*)\.js$/.test(fn) && !bIsUrl(fn) && !fs.existsSync(path.join(CONFIG_WBHOOK.jspath, fn))) {
        res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' })
        res.end(fn + ' 不存在')
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' })
        res.write('<style>li {list-style: none;white-space: pre-wrap;}</style>')
        res.write(`
          <script>
            const wsSer = location.origin.replace('http', 'ws') + '/elecV2P'
            const ws = new WebSocket(wsSer)
            ws.onopen = ()=>{
              ws.send(JSON.stringify({ type: 'ready', data: 'wbrun' }))
              ws.send(JSON.stringify({ type: 'wbrun', data: '${fn}' }))
            }
            ws.onmessage = msg => {
              let data = JSON.parse(msg.data)
              if (data.type === 'wbrun') {
                document.body.insertAdjacentHTML('afterbegin', '<li>' + data.data + '</li>')
              }
            }
            ws.onclose = close => {
              console.error("WebSocket closed", close)
              document.body.insertAdjacentHTML('afterbegin', 'WebSocket closed, 无法获取 JS 运行日志，请在服务器端查看 JS 运行结果')
            }
            ws.onerror = error => {
              console.error('WebSocket error', error)
              document.body.insertAdjacentHTML('afterbegin', 'WebSocket error, 无法获取 JS 运行日志，请在服务器端查看 JS 运行结果')
            }
          </script>
        `)
        res.end()
      }
    } else if (req.query.type === 'deletelog') {
      res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' })
      let name = req.query.fn
      if (name == 'all') {
        fs.readdirSync(CONFIG_WBHOOK.logspath).forEach(file=>{
          clog.info(clientip, 'delete log file:', file)
          fs.unlinkSync(path.join(CONFIG_WBHOOK.logspath, file))
        })
        res.end('所有 log 文件已删除')
      } else if(fs.existsSync(path.join(CONFIG_WBHOOK.logspath, name))){
        clog.info(clientip, 'delete log file', name)
        fs.unlinkSync(path.join(CONFIG_WBHOOK.logspath, name))
        res.end(name + ' 已删除')
      } else {
        res.end('不存在 log 文件 ' + name)
      }
    } else if (req.query.type === 'status') {
      res.end(JSON.stringify(nStatus()))
    } else if (req.query.type === 'taskinfo') {
      res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' })
      for (let tid in TASKS_INFO) {
        if (TASKS_INFO[tid].name === req.query.tn) {
          res.end(JSON.stringify(TASKS_INFO[tid]))
          break
        }
      }
    } else if (req.query.type === 'taskstart') {
      res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' })
      for (let tid in TASKS_INFO) {
        if (TASKS_INFO[tid].name === req.query.tn && TASKS_WORKER[tid]) {
          if (TASKS_INFO[tid].running === false) {
            TASKS_WORKER[tid].start()
            res.end(TASKS_INFO[tid].name + ' 开始运行，任务内容： ' + JSON.stringify(TASKS_INFO[tid]))
          } else {
            res.end(req.query.tn + ' 任务正在运行中，任务内容： ' + JSON.stringify(TASKS_INFO[tid]))
          }
          return
        }
      }
      res.end(req.query.tn + ' 任务不存在')
    } else if (req.query.type === 'taskstop') {
      res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' })
      for (let tid in TASKS_INFO) {
        if (TASKS_INFO[tid].name === req.query.tn && TASKS_WORKER[tid]) {
          if (TASKS_INFO[tid].running === true) {
            TASKS_WORKER[tid].stop()
            res.end('停止任务 ' + TASKS_INFO[tid].name + '，任务内容： ' + JSON.stringify(TASKS_INFO[tid]))
          } else {
            res.end(req.query.tn + ' 任务已停止，任务内容： ' + JSON.stringify(TASKS_INFO[tid]))
          }
          return
        }
      }
      res.end(req.query.tn + ' 任务不存在')
    } else {
      res.end('wrong webhook type')
    }
  })
}