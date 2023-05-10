const fs = require('fs');
const path = require('path');

module.exports = {
    readdir: (dirname) => {
        return fs.readdirSync( dirname );
    },
    
    check_dir: (...dirname) => {
        let dir = dirname.join(path.sep);
        console.log('Checking directory: ' + dir)
        try {
            let dir_d = fs.opendirSync( path.join(__dirname, dir) );
            dir_d.closeSync();
        } catch (e){
            if (e.code === 'ENOENT') {
                try{
                    fs.mkdirSync( path.join(__dirname, dir), {recursive: true} );
                } catch (e2) {
                    throw new Error(e2);
                }
            } else {
                throw new Error(e);
            }
        }
    },

    loadFileSync: (filepath, isjson = false ) => {
        try {
            console.log ('loading file:', path.relative( __dirname, filepath) );
            var data = fs.readFileSync( filepath );
            if (isjson){
                data = JSON.parse(data);
            }
            console.log ('loaded');
            return data;
        } catch (err) {
            if (err.code === 'ENOENT'){
                console.log ('file not found');
                return null;
            } else {
                throw new Error(err);
            }
        }
    },

    saveFileSync: (filepath, data, isjson = false) => {
        try {
            module.exports.check_dir(path.dirname(path.relative( __dirname, filepath)));
            console.log ('saving file:', path.relative( __dirname, filepath) );
            if (isjson){
                fs.writeFileSync( filepath, JSON.stringify(data) );
            } else {
                fs.writeFileSync( filepath, data );
            }
            console.log ('saved');
        } catch (err) {
            throw new Error(err);
        }
    },

    isFileExists: (filepath) => {
        return fs.existsSync( filepath );
    },
}
