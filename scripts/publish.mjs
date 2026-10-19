/**
 * Publishes the extension to npm, which is what the extension market reads.
 *
 *   node scripts/publish.mjs            # check, then publish
 *   node scripts/publish.mjs --dry-run  # check, then a publish rehearsal
 *
 * Needs an npm account: run `npm login` first (the one step this script cannot do for you).
 * After the upload the market picks the package up from npm on its next sync; see the notes printed
 * at the end.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const dry = process.argv.includes('--dry-run');
const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));

const wait = (child) => new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));

/**
 * Run a node script with this Node. No shell: the executable path itself contains spaces
 * ("C:\Program Files\nodejs\node.exe"), and handing it to cmd.exe splits it at the first space.
 */
const runNode = (args) => wait(spawn(process.execPath, args, { cwd: root, stdio: 'inherit' }));

/**
 * Run npm. On Windows npm is a `.cmd`, which Node refuses to start without a shell (and with a
 * shell the arguments would be concatenated), so cmd.exe is started explicitly instead.
 */
const runNpm = (args) => new Promise((resolve) => {
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: root, windowsVerbatimArguments: true })
    : spawn('npm', args, { cwd: root });
  let out = '';
  child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
  child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
  child.on('exit', (code) => resolve({ code: code ?? 1, out }));
});

console.log(`\n[1/4] 发布自检 (${pkg.name}@${pkg.version})`);
if (await runNode(['scripts/check-package.mjs'])) process.exit(1);

console.log('\n[2/4] 兼容补丁回归（在临时副本上，不动本机安装）');
if (await runNode(['scripts/test-patch.mjs'])) process.exit(1);

/**
 * Ask for the one-time password only after the checks are done, so the 30-second window is not
 * spent waiting for them. `--ask-otp` makes that explicit; without a terminal it is skipped.
 */
async function askOtp() {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('\n请输入 npm 验证器里的 6 位一次性密码（直接回车则跳过，交给 npm 自己问）：')).trim();
  rl.close();
  return /^\d{6}$/.test(answer) ? `--otp=${answer}` : null;
}

console.log('\n[3/4] 确认 npm 凭据');
const who = await runNpm(['whoami']);
if (who.code) {
  console.error(`
没有有效的 npm 凭据，发布无法继续。两种恢复方式，任选其一：

  A. 用浏览器登录（之后发布仍可能需要 2FA）
     npm login

  B. 用一个带发布权限、勾了 Bypass 2FA 的 token（同时解决登录和 2FA）
     npm config set //registry.npmjs.org/:_authToken=<token>

设好后执行 npm whoami，应输出 chen987654321，再重跑本脚本。
`);
  process.exit(1);
}
console.log(`以 ${who.out.trim().split(/\r?\n/).filter(Boolean).pop()} 的身份发布`);

console.log(`\n[4/4] ${dry ? '打包预演' : '上传到 npm'}`);
// npm 2FA: the one-time password can be passed straight through, or asked for here.
const asked = process.argv.includes('--ask-otp') && !dry ? await askOtp() : null;
const otp = process.argv.find((a) => /^--otp=\d{6}$/.test(a)) ?? asked;
const res = await runNpm(['publish', '--access', 'public', ...(otp ? [otp] : []), ...(dry ? ['--dry-run'] : [])]);
if (res.code) {
  const out = res.out;
  const twoFactor = /two-factor|EOTP/i.test(out);
  const noAuth = /E401|ENEEDAUTH|Unauthorized/i.test(out);
  const conflict = /EPUBLISHCONFLICT|E409|cannot publish over/i.test(out);
  const network = /ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(out);
  const advice = twoFactor
    ? `这个账号开启了发布时的两步验证，需要一次性密码（OTP），或用带 Bypass 2FA 的 token。
  · App 有 6 位码：node scripts/publish.mjs --ask-otp
  · 只有邮箱验证码：邮箱码不能用于发布，改用 token：
      npm config set //registry.npmjs.org/:_authToken=<Bypass 2FA 的 token>`
    : noAuth
      ? `npm 说没有有效凭据（401）。先登录，或者设置一个带发布权限的 token：
  · npm login                     （浏览器授权）
  · npm config set //registry.npmjs.org/:_authToken=<token>
  设好后用 npm whoami 确认，应回 chen987654321。`
      : conflict
        ? `这个版本号已经发布过了。改 package.json 的 version，并在 CHANGELOG.md 加一段 "## 新版本号"。`
        : network
          ? `连不上 registry.npmjs.org。检查代理/VPN；公司网络可试 npm config set registry https://registry.npmmirror.com（但市场扫的是官方 npm，发布必须走官方源）。`
          : `名字可能已被占用，或账号没有该包/该作用域的发布权限。可以改 package.json 的 name 后重试。`;
  const tail = out.trim().split(/\r?\n/).slice(-6).join('\n');
  console.error(`
发布没有完成（退出码 ${res.code}）。

${advice}

npm 的最后几行（判断依据）：
${tail}
`);
  process.exit(res.code);
}

console.log(`
${dry ? '预演完成（没有上传）' : '上传完成'}：${pkg.name}@${pkg.version}

接下来（市场收录，通常几分钟到一次定时任务）：
  1. 确认 npm 上能查到： npm view ${pkg.name} version
  2. 市场由 Pal-AI-Lab/cortico-extensions 的 Action 定时扫 npm 生成；
     想立刻刷新，在那里开一个标题为 [sync] 的 issue。
  3. 首次发布 14 天内，市场卡片会带「新品」徽标。
  4. Coopanion 里：设置 → 扩展 → 搜索「${pkg.cortico?.displayName ?? pkg.name}」→ 安装 → 打开窗边客面板 → 点「应用兼容补丁」→ 重启。
`);
