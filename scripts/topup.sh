#!/usr/bin/env bash
#
# iDoris 本地充值 —— 只在你本机运行，用你的 wrangler(Cloudflare) 凭证直接写 KV。
# 不经过任何公网接口：线上不存密钥、无攻击面。密钥只在 ~/Dev/.env 本机做二次确认。
#
# 用法:
#   ./scripts/topup.sh <wallet> <credits>      # 直接加 N 积分
#   ./scripts/topup.sh <wallet> --usd 5        # 按 0.02/积分 折算($5 -> 250)
#   ./scripts/topup.sh <wallet> --points 100   # 社区积分 1:1
#   ./scripts/topup.sh <wallet> --balance      # 只查余额
#
set -euo pipefail
NS="3df54b52643c41c192873cd0d6c96bba"
USD_PER_CREDIT="0.02"
ENV_FILE="${HOME}/Dev/.env"
die(){ echo "[x] $1" >&2; exit 1; }

WALLET="${1:-}"; shift || true
[[ "${WALLET}" =~ ^[a-f0-9]{12,40}$ ]] || die "wallet code must be 12-40 hex"

MODE="add"; ARG="${1:-}"; VAL="${2:-}"; CREDITS="0"
case "${ARG}" in
  --usd)     CREDITS=$(python3 -c "print(int(round(float('${VAL}')/float('${USD_PER_CREDIT}'))))") ;;
  --points)  CREDITS="${VAL}" ;;
  --balance) MODE="balance" ;;
  "")        die "missing amount, e.g. ./scripts/topup.sh WALLET 100" ;;
  *)         CREDITS="${ARG}" ;;
esac

# 本机校验：~/Dev/.env 里必须有 IDORIS_ADMIN_SECRET（＝在你本机跑），不再要你手输密码
if ! { [ -f "${ENV_FILE}" ] && grep -q '^IDORIS_ADMIN_SECRET=' "${ENV_FILE}"; }; then
  die "缺少 ${ENV_FILE} 里的 IDORIS_ADMIN_SECRET（本机校验）"
fi

CUR_FILE=$(mktemp)
npx wrangler kv key get "ent:${WALLET}" --namespace-id="${NS}" --remote > "${CUR_FILE}" 2>/dev/null || true

if [ "${MODE}" = "balance" ]; then
  python3 - "${CUR_FILE}" "${WALLET}" <<'PY'
import sys,json
raw=open(sys.argv[1]).read().strip()
try: d=json.loads(raw) if raw.startswith("{") else {}
except Exception: d={}
print("wallet", sys.argv[2], "balance:", d.get("remaining",0), "credits")
PY
  rm -f "${CUR_FILE}"; exit 0
fi

[[ "${CREDITS}" =~ ^[0-9]+$ ]] && [ "${CREDITS}" -gt 0 ] || die "credits must be a positive integer (got ${CREDITS})"

# 可见确认（普通输入，不是密码）
USD_SHOW=$(python3 -c "print('%.2f' % (${CREDITS}*${USD_PER_CREDIT}))")
printf '→ 给钱包 %s 充 %s 积分 (约 $%s)\n' "${WALLET}" "${CREDITS}" "${USD_SHOW}"
read -r -p "确认充值? [y/N] " YN
[ "${YN}" = "y" ] || [ "${YN}" = "Y" ] || die "已取消"

OUT_FILE=$(mktemp)
python3 - "${CUR_FILE}" "${OUT_FILE}" "${WALLET}" "${CREDITS}" "${USD_PER_CREDIT}" <<'PY'
import sys,json,time
curf,outf,wallet,credits,upc=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4]),float(sys.argv[5])
raw=open(curf).read().strip()
try: d=json.loads(raw) if raw.startswith("{") else {}
except Exception: d={}
if not d: d={"code":wallet,"tokens":0,"remaining":0,"created":int(time.time()*1000),"status":"active"}
d["tokens"]=d.get("tokens",0)+credits
d["remaining"]=d.get("remaining",0)+credits
d["updated"]=int(time.time()*1000)
open(outf,"w").write(json.dumps(d,ensure_ascii=False))
print("new balance:", d["remaining"], "credits (this +%d, approx $%.2f)" % (credits, credits*upc))
PY

npx wrangler kv key put "ent:${WALLET}" --path="${OUT_FILE}" --namespace-id="${NS}" --remote >/dev/null 2>&1 \
  && echo "[ok] credited wallet ${WALLET}" || die "KV write failed (check wrangler login)"
rm -f "${CUR_FILE}" "${OUT_FILE}"
