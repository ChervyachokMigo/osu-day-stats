const fs = require('fs');
const path = require('path');
const { v2, auth } = require('osu-api-extended')

const express = require('express');
const app = express();
const bodyParser = require('body-parser');

const HTTP_PORT = 10577;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const osu_login = process.env.osu_login;
const osu_password = process.env.osu_password;

try {
    fs.opendirSync(path.join(__dirname, 'beatmaps'));
} catch (e){
    if (e.code === 'ENOENT') {
        try{
            fs.mkdirSync(path.join(__dirname, 'beatmaps'));
        } catch (e2) {
            throw new Error(e2);
        }
    } else {
        throw new Error(e);
    }
}

try {
    fs.opendirSync(path.join(__dirname, 'scores'));
} catch (e){
    if (e.code === 'ENOENT') {
        try{
            fs.mkdirSync(path.join(__dirname, 'scores'));
        } catch (e2) {
            throw new Error(e2);
        }
    } else {
        throw new Error(e);
    }
}

const check_credentials = ()=>{
    if (osu_login === undefined || osu_password === undefined) return false;
    return true;
}

/*const is_login_expired = ()=>{
    try {
        console.log('checking login date');
        const token_info = fs.readFileSync(path.join(__dirname, 'login_token.json'));
        const now_seconds = Math.trunc(new Date().getTime()/1000);
        if (token_info.enddate >= now_seconds){
            return true;
        }
        

        console.log('you have access token. ready to requests')
        return false;
    } catch (e){
        if (e.code === 'ENOENT') return true;

        console.error(e);
        return true;
    }
}*/

const check_login = async()=>{
    //access_token
    //expires_in
    try{
        console.log('try login')
        var token_info = await auth.login_lazer(osu_login, osu_password);
        if (token_info && token_info.access_token === undefined){
            throw new Error('Login failed. Recheck your credentials');
        }
        //const now_seconds = Math.trunc(new Date().getTime()/1000);
        //token_info.enddate = now_seconds + token_info.expires_in;
        //fs.writeFileSync(path.join(__dirname,'login_token.json'), JSON.stringify(token_info));
        return true;
    } catch (e){
        throw new Error(e);
    }
    
}

const get_user_id = async () => {
    try {
        const user_id = fs.readFileSync(path.join(__dirname, 'user_id.json'));
        return Number(user_id);
    } catch (e){
        if (e.code === 'ENOENT') {
            try {
                const user_info =  await v2.user.me.details('osu');
                return user_info.id;
            } catch (e2){
                throw new Error(e2);
            }
        }
    }
    
}

const get_beatmap_info = async (beatmap_id) => {
    try {
        const beatmap_info = fs.readFileSync(path.join(__dirname, 'beatmaps', beatmap_id.toString()));
        return JSON.parse(beatmap_info);
    } catch (e) {
        if (e.code === 'ENOENT') {
            try{
                const beatmap_info = await v2.beatmap.diff(beatmap_id);
                fs.writeFileSync(path.join(__dirname, 'beatmaps', beatmap_id.toString()), JSON.stringify(beatmap_info));
                return beatmap_info;
            } catch (e2){
                throw new Error(e2);
            }
        } else {
            throw new Error(e);
        }
    }
}



const get_recent_scores = async (user_id) => {

    var user_scores = await v2.user.scores.category(user_id, 'recent', {mode: 'osu'});

    var user_fcs = [];

    var daily_stats = {
        fc_efficiency: 0,
        avg_stars: 0,
        avg_combo: 0,
        avg_length: 0,
        avg_accuracy: 0
    };

    const today = new Date().toJSON().slice(0, 10);

    for (let user_score of user_scores){ 
        if (today !== new Date(user_score.created_at).toJSON().slice(0, 10)) continue;
        let beatmap_info = await get_beatmap_info(user_score.beatmap.id);
        let beatmap_max_combo = beatmap_info.max_combo;
        let beatmap_length = beatmap_info.hit_length;
        let stars = beatmap_info.difficulty_rating;
        
        let user_combo = user_score.max_combo;
        let user_accuracy = user_score.accuracy;

        let combo_allowed = beatmap_max_combo * 0.99;

        if (user_combo > combo_allowed){
            let fc_efficiency = user_accuracy * (user_combo / beatmap_max_combo) * ( ((stars * ((beatmap_length / 120) * 0.1) + stars * 0.9)) / 5 );
            let user_fc_info = {
                beatmap_title: `${beatmap_info.beatmapset.artist} - ${beatmap_info.beatmapset.title} [${beatmap_info.version}]`,
                beatmap_preview: beatmap_info.beatmapset.preview_url,
                beatmap_bg: beatmap_info.beatmapset.covers.list,
                beatmap_id: beatmap_info.id,
                user_combo,
                max_combo: beatmap_max_combo,
                user_accuracy,
                stars,
                beatmap_length,
                fc_efficiency
            }

            daily_stats.fc_efficiency += fc_efficiency;
            daily_stats.avg_stars += stars;
            daily_stats.avg_combo += user_combo;
            daily_stats.avg_length += beatmap_length;
            daily_stats.avg_accuracy += user_accuracy*100;

            user_fcs.push(user_fc_info);
        }

    }

    if (user_fcs.length == 0){
        console.log({daily_stats, user_fcs})
        return {daily_stats, user_fcs};
    }

    daily_stats.fc_efficiency /= user_fcs.length;
    daily_stats.avg_combo /= user_fcs.length;
    daily_stats.avg_stars /= user_fcs.length;
    daily_stats.avg_length /= user_fcs.length;
    daily_stats.avg_accuracy /= user_fcs.length;

    daily_stats.fc_efficiency = floor(daily_stats.fc_efficiency);
    daily_stats.avg_stars = floor(daily_stats.avg_stars);
    daily_stats.avg_combo = floor(daily_stats.avg_combo);
    daily_stats.avg_length = floor(daily_stats.avg_length,0);
    daily_stats.avg_accuracy = floor(daily_stats.avg_accuracy);

    
    user_fcs.sort((val1,val2)=>val2.fc_efficiency - val1.fc_efficiency );

    var result = {daily_stats, user_fcs};

    try{
        fs.writeFileSync(path.join(__dirname, 'scores', today), JSON.stringify(result));
    } catch (e){
        console.error(e);
    }

    try{
        const yesterday = (new Date((new Date(today)).setDate((new Date(today)).getDate()-1))).toJSON().slice(0, 10);
        var yesterday_stats = fs.readFileSync(path.join(__dirname, 'scores', yesterday));
        yesterday_stats = JSON.parse(yesterday_stats);
        result.yesterday_daily = yesterday_stats.daily_stats;
    } catch (e){
        if (e.code !== 'ENOENT'){
            console.error(e)
        }
    }

    return result;
}

const floor = (val, digits=2)=>{
    return (Math.trunc(val*100)*0.01).toFixed(digits);
}

const main = (async () => {

    if ( ! check_credentials()){
        throw new Error('"osu_login" or "osu_password" are not in environment. Add from "computer settings > environment variables" and relogin winddows.');
    } else {
        console.log('check_credentials complete. logining...');
    }

    if (await check_login()){
        console.log('you are logged in.');
    }

    const user_id = await get_user_id();

    app.listen(HTTP_PORT, ()=>{
        console.log(`Webserver listening on http://localhost:${HTTP_PORT}`);
    });

    app.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error('Address in use, retrying...');
        }
    });
    
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'web', 'index.html'));
    });
    
    app.get('/jquery.min.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'web', 'jquery.min.js'));
    });
    
    app.get('/styles.css', (req, res) => {
        res.sendFile(path.join(__dirname, 'web', 'styles.css'));
    });
    
    app.get('/favicon.ico', (req, res) => {
        res.sendFile(path.join(__dirname, 'web', 'favicon.png'));
    });

    app.get('/play.png', (req, res) => {
        res.sendFile(path.join(__dirname, 'web', 'play.png'));
    });

    app.get('/pause.png', (req, res) => {
        res.sendFile(path.join(__dirname, 'web', 'pause.png'));
    });

    app.post('/load_last_recent_scores', async (req, res) => {
        var last_recent_scores = await get_recent_scores(user_id);
        res.send(JSON.stringify(last_recent_scores));
    });  
   
})();