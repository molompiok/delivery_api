import FileTest from '#models/file_test'; const tests = await FileTest.all(); for (const t of tests) { await t.delete(); }
