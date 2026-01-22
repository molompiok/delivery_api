import File from '#models/file'; const files = await File.all(); console.log(files.map(f => ({id: f.id, name: f.name})))
