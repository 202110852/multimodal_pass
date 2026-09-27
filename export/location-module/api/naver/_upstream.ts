type NaverCredentials = { clientId: string; clientSecret: string };

function getNaverCredentials(): NaverCredentials | null {
  const clientId = process.env.NAVER_API_KEY_ID;
  const clientSecret = process.env.NAVER_API_KEY;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** 네이버 Maps API(NCP) 호출. 키가 없으면 null. */
export async function fetchNaverApi(
  path: string,
  searchParams: URLSearchParams,
): Promise<{ status: number; body: string } | null> {
  const credentials = getNaverCredentials();
  if (!credentials) return null;

  const url = new URL(`https://maps.apigw.ntruss.com${path}`);
  url.search = searchParams.toString();

  const upstream = await fetch(url.toString(), {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": credentials.clientId,
      "X-NCP-APIGW-API-KEY": credentials.clientSecret,
      Accept: "application/json",
    },
  });

  return { status: upstream.status, body: await upstream.text() };
}
