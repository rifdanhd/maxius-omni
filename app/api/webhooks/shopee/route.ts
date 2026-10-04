import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  isPushSignatureFormatValid,
  pushUrlVariants,
  shopeePushUrlCandidates,
  verifyPushSignature,
} from "@/lib/integrations/shopee";
import { listActiveShopeeSecrets } from "@/lib/services/app-credential.service";
import {
  handleShopeeOrderUpdate,
  logShopeeSync,
} from "@/lib/services/shopee-order-webhook.service";

type ShopeePush = {
  code?: number;
  shop_id?: number | string;
  timestamp?: number;
  data?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const authHeader = req.headers.get("authorization");

  // Shopee Console "Verify / Get Test Push" hanya mengecek status 2xx.
  // Signature gagal → JANGAN 401 (gagal verify); cukup jangan proses payload.
  let secrets: string[] = [];
  try {
    secrets = await listActiveShopeeSecrets();
  } catch (e) {
    console.error("[webhook/shopee] gagal ambil partner secrets:", e);
    return new Response(null, { status: 200 });
  }

  const urlCandidates = shopeePushUrlCandidates(req);
  const verified = secrets.some((key) =>
    verifyPushSignature(rawBody, authHeader, urlCandidates, {
      partnerId: "",
      partnerKey: key,
    })
  );
  if (!verified) {
    console.warn(
      "[webhook/shopee] signature invalid (skip process)",
      {
        reason: !authHeader
          ? "missing_authorization"
          : !isPushSignatureFormatValid(authHeader)
            ? "invalid_signature_format"
            : secrets.length === 0
              ? "no_candidate_keys"
              : "signature_mismatch",
        candidateKeyCount: secrets.length,
        authorizationPresent: authHeader !== null,
        authorizationLength: authHeader?.length ?? 0,
        rawBodyBytes: Buffer.byteLength(rawBody, "utf8"),
        urlCandidates: [...new Set(urlCandidates.flatMap(pushUrlVariants))],
      }
    );
    return new Response(null, { status: 200 });
  }

  let payload: ShopeePush;
  try {
    payload = JSON.parse(rawBody) as ShopeePush;
  } catch {
    return new Response(null, { status: 200 });
  }

  const shopId = payload.shop_id !== undefined && payload.shop_id !== null
    ? String(payload.shop_id)
    : null;
  if (!shopId) return new Response(null, { status: 200 });

  const account = await prisma.platformAccount.findUnique({
    where: { platform_externalShopId: { platform: "SHOPEE", externalShopId: shopId } },
    select: { id: true, isFrozen: true, frozenReason: true },
  });
  if (!account) {
    console.warn(`[webhook/shopee] unknown shop_id: ${shopId}`);
    return new Response(null, { status: 200 });
  }
  if (account.isFrozen) {
    console.warn(
      `[webhook/shopee] push dari akun dibekukan ${shopId} diabaikan (${account.frozenReason ?? "tanpa alasan"}).`
    );
    return new Response(null, { status: 200 });
  }

  try {
    const code = Number(payload.code);
    if (code === 3) {
      await handleShopeeOrderUpdate(account.id, rawBody, payload.data ?? {});
    } else if (code === 1) {
      await logShopeeSync({
        accountId: account.id,
        kind: "shop_authorization",
        status: "success",
        message: "Otorisasi toko Shopee berubah.",
        payload: rawBody,
      });
    } else if (code === 2) {
      // shop_authorization_canceled_push — seller mencabut otorisasi.
      // Hapus token agar UI terbaca Terputus + API tidak dipanggil sia-sia.
      await prisma.platformAccount.update({
        where: { id: account.id },
        data: { accessToken: null, refreshToken: null, tokenExpiresAt: null },
      });
      await logShopeeSync({
        accountId: account.id,
        kind: "shop_deauthorization",
        status: "skipped",
        message: "Otorisasi Shopee dicabut seller — akun ditandai terputus, hubungkan ulang.",
        payload: rawBody,
      });
    } else if (code === 12) {
      // open_api_authorization_expiry — H-7 sebelum authorization expired.
      await logShopeeSync({
        accountId: account.id,
        kind: "authorization_expiry_warning",
        status: "skipped",
        message: "Otorisasi Shopee segera kedaluwarsa — minta seller authorize ulang.",
        payload: rawBody,
      });
    } else {
      await logShopeeSync({
        accountId: account.id,
        kind: `unknown_code_${Number.isFinite(code) ? code : "na"}`,
        status: "skipped",
        message: "Topik push Shopee tidak dikenali / tidak disubscribe.",
        payload: rawBody,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[webhook/shopee] process error utk akun ${account.id}:`, err);
    await logShopeeSync({
      accountId: account.id,
      kind: "webhook_process_error",
      status: "error",
      errorMessage: message,
      payload: rawBody,
    });
  }

  return new Response(null, { status: 200 });
}
