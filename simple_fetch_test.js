async function testFetch() {
    const url = 'https://wallet.sublymus.com/v1/wallets/main';
    const headers = {
        'Authorization': 'Bearer wave_usr_1azkfblvgc7k4ohx8j_1771464191424_cag2pxpc25h',
        'X-Manager-Id': 'usr_1azkfblvgc7k4ohx8j'
    };

    console.log(`Fetching ${url}...`);
    try {
        const res = await fetch(url, { headers });
        console.log(`Status: ${res.status}`);
        const data = await res.json();
        console.log('Data:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

testFetch();
