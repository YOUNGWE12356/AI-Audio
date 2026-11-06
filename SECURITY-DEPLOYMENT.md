# 安全配置与升级

1. 优先使用已有飞书登录：配置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REDIRECT_URI`，回调路径为 `/api/auth/callback`；`FEISHU_AUTH_ENABLED=true` 显式启用（配置齐全时也会自动启用）。兼容 `LARK_` 别名。登录入口 `/api/auth/lark`，当前身份 `/api/auth/me`，退出 `POST /api/auth/logout`。飞书启用时禁止本地密码登录，游客登录已移除，旧开关不再生效。

   仅在未启用飞书时，可为每位使用者配置独立本地账号。运行 `npm run auth:hash-password`，在隐藏输入提示下输入至少 16 位密码，将输出的 scrypt 哈希写入部署环境的 `AUTH_USERS_JSON`：

   ```json
   [{"id":"alice","displayName":"Alice","passwordHash":"scrypt$<32 hex salt>$<128 hex hash>"}]
   ```

   不要提交真实配置或密码。飞书未启用且本地账号列表为空时，所有业务接口拒绝访问。飞书身份来自服务端换取的用户资料，设备 ID 不作为认证依据。旧版登录 cookie 不予信任，升级后需重新飞书授权。

2. 生产环境设置 `NODE_ENV=production`，由 HTTPS 网关转发应用。`APP_ORIGIN` 默认使用飞书回调的 origin；显式设置时必须与回调 origin 一致。无飞书时生产环境必须配置 `APP_ORIGIN=https://实际域名`（无结尾斜杠），开发默认 `http://localhost:4030`。浏览器修改请求须携带匹配的 Origin。网关不要直接公开上传目录或构建目录；只代理应用的鉴权路由。

3. 管理功能可选配置独立的高熵 `SFX_LIBRARY_ADMIN_PASSWORD`，至少 24 位。员工先登录，再输入管理密码取得 30 分钟管理权限。管理权限绑定当前会话，不向浏览器发放管理 bearer token。基础登录会话为 8 小时，注销或重启进程即失效。设置页提供退出登录。

4. `npm run build` 输出 `dist/client` 与 `dist/server`，`npm start` 使用后者。仅 `dist/client` 可作为前端静态目录；不得把整个 `dist` 挂载到外部静态服务器。服务端 source map 仅供受控运维使用。公共前缀 `VITE_`、`NEXT_PUBLIC_`、`REACT_APP_` 禁止配置密钥或密码，构建与启动都会检查。

5. 上传和产物存储在 `data/private-uploads/<账号摘要>/`，通过已认证的 `/uploads/...` 路由读取。`data` 需要持久化并仅对服务账号开放。旧 `uploads/` 和旧设备身份任务不会自动归属任何账号，禁止把旧文件一键设为所有人可读；需要由管理员核对归属后离线迁移。共享音效库继续使用 `SFX_LIBRARY_DIR`，所有读取要求登录，写入要求管理权限。

6. 修改请求限制为每账号最多 4 个、全服务最多 16 个并行请求；账号文件存量超过 1 GiB 后拒绝新的制作请求（在途请求可能继续产生文件），单文件上限 100 MiB。分轨队列最多 32 个等待任务、每账号最多 2 个未完成任务。反向代理还应设置请求体、连接数和磁盘配额。速率限制、会话及任务队列保存在进程内；目前只支持单进程部署，多副本前必须改用共享会话、限流与队列存储。

7. 若旧版本已暴露于不可信网络，先停用旧下载接口，并通过各密钥提供方撤销、重新签发可能暴露的 API 密钥、管理密码及相关应用密钥。代码修改无法替代服务提供方的密钥撤销。

验证命令：`npm run lint`、`npm run build`、`npm run test:security`。集成测试只使用临时目录、测试账号与本机 HTTP 服务，不调用真实付费模型。
