async function testGoogle() {
    console.log('Fetching https://google.com...');
    try {
        const res = await fetch('https://google.com');
        console.log(`Status: ${res.status}`);
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

testGoogle();
