async function testFetch() {
    const url = 'https://92.112.193.206/v1/wallets/main';
    const headers = {
        'Authorization': 'Bearer wave_usr_1azkfblvgc7k4ohx8j_1771464191424_cag2pxpc25h',
        'X-Manager-Id': 'usr_1azkfblvgc7k4ohx8j',
        'Host': 'wallet.sublymus.com'
    };

    console.log(`Fetching ${url} (Host: wallet.sublymus.com)...`);
    try {
        // NODE_TLS_REJECT_UNAUTHORIZED is needed because the certificate is for sublymus.com
        const res = await fetch(url, {
            headers,
            // @ts-ignore
            dispatcher: new (await import('undici')).Agent({
                connect: {
                    rejectUnauthorized: false
                }
            })
        });
        console.log(`Status: ${res.status}`);
        const data = await res.json();
        console.log('Data:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

testFetch();
