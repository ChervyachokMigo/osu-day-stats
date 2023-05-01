const fs = require('fs');
const path = require('path');
const { v2, auth } = require('osu-api-extended')

const express = require('express');
const app = express();
const bodyParser = require('body-parser');

const HTTP_PORT = 10577;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const webserver_dir = 'web';

const osu_login = process.env.osu_login;
const osu_password = process.env.osu_password;

const combo_is_fc = 0.99; //%
const score_mode = 'osu';
const length_significance = 0.1; //0-1
const efficiency_multiplier = 5;
const weight_multiplier = 0.14285714;

const check_dir = (dirname) => {
    try {
        fs.opendirSync(path.join(__dirname, dirname));
    } catch (e){
        if (e.code === 'ENOENT') {
            try{
                fs.mkdirSync(path.join(__dirname, dirname));
            } catch (e2) {
                throw new Error(e2);
            }
        } else {
            throw new Error(e);
        }
    }
}

check_dir('beatmaps');
check_dir('scores');
check_dir('stats');

const check_credentials = ()=>{
    if (osu_login === undefined || osu_password === undefined) return false;
    return true;
}

const PathListener = (webserver_descriptor, filepath, filename) =>{
    webserver_descriptor.get(filepath, (req, res) => {
        res.sendFile(path.join(__dirname, webserver_dir, filename));
    });
}

const check_login = async()=>{
    //access_token
    //expires_in
    try{
        console.log('try login')
        var token_info = await auth.login_lazer(osu_login, osu_password);
        if (token_info && token_info.access_token === undefined){
            throw new Error('Login failed. Recheck your credentials');
        }
        return true;
    } catch (e){
        throw new Error(e);
    }
    
}

const get_user_id = async () => {
    try {
        const user_id = fs.readFileSync( path.join(__dirname, 'user_id') );
        return Number(user_id);
    } catch (e){
        if (e.code === 'ENOENT') {
            try {
                const user_info =  await v2.user.me.details('osu');
                try{
                    fs.writeFileSync( path.join(__dirname, 'user_id' ), user_info.id.toString() );
                } catch (e2){
                    throw new Error(e2);
                }
                return user_info.id;
            } catch (e1){
                throw new Error(e1);
            }
        }
    }
    
}

const get_beatmap_info = async (beatmap_id) => {
    try {
        const beatmap_info = fs.readFileSync(path.join(__dirname, 'beatmaps', beatmap_id.toString() ));
        return JSON.parse(beatmap_info);
    } catch (e) {
        if (e.code === 'ENOENT') {
            try{
                const beatmap_info = await v2.beatmap.diff(beatmap_id);
                fs.writeFileSync(path.join(__dirname, 'beatmaps', beatmap_id.toString() ), JSON.stringify(beatmap_info));
                return beatmap_info;
            } catch (e2){
                throw new Error(e2);
            }
        } else {
            throw new Error(e);
        }
    }
}

const get_user_stats = (date) => {
    var stats = {
        fc_efficiency: 0,
        avg_stars: 0,
        avg_combo: 0,
        avg_length: 0,
        avg_accuracy: 0,
        total_pp: 0,
        scores_ids: []
    };
    try {
        var stats_json = fs.readFileSync(path.join(__dirname, 'stats', date.toString() ));
        stats = JSON.parse(stats_json);
    } catch (e){
        //console.log(e);
    }
    return stats;
}

const get_score_fc_info = async (score) => {
    const beatmap_info = await get_beatmap_info(score.beatmap.id);

    let score_id = score.id;
    let beatmap_max_combo = beatmap_info.max_combo;
    let beatmap_length = beatmap_info.hit_length;
    let stars = beatmap_info.difficulty_rating;
    let pp = score.pp;
    
    let combo = score.max_combo;
    let accuracy = score.accuracy;

    let combo_allowed = beatmap_max_combo * combo_is_fc;

    if (combo >= combo_allowed){
        let fc_efficiency = accuracy * (combo / beatmap_max_combo) *
            ( ((stars * ((beatmap_length / 120) * length_significance) + 
                stars * (1-length_significance))) / 
                    efficiency_multiplier );
        
        let score_fc_info = {
            score_id,
            beatmap_title: `${beatmap_info.beatmapset.artist} - ${beatmap_info.beatmapset.title} [${beatmap_info.version}]`,
            beatmap_preview: beatmap_info.beatmapset.preview_url,
            beatmap_bg: beatmap_info.beatmapset.covers.list,
            beatmap_id: beatmap_info.id,
            combo,
            max_combo: beatmap_max_combo,
            accuracy,
            stars,
            beatmap_length,
            fc_efficiency,
            pp
        }

        try{
            if (!fs.existsSync(path.join(__dirname, 'scores', score_id.toString() ))){
                try{
                    fs.writeFileSync(path.join(__dirname, 'scores', score_id.toString() ), JSON.stringify(score_fc_info));
                } catch (e2){
                    throw new Error(e2);
                }
            }
        } catch (e1){
            console.error(e1);
        }

        return score_fc_info;
    } else {
        return undefined;
    }
}

const read_score = (score_id) => {
    try{
        var score_json = fs.readFileSync(path.join(__dirname, 'scores', score_id.toString() ));
        return JSON.parse(score_json);
    } catch (e){
        throw new Error(e);
    }
}

const floor = (val, digits=2)=>{
    return (Math.trunc(val*100)*0.01).toFixed(digits);
}

const calculate_stats = (old_stats, date) => {
    const scores_length = old_stats.scores_ids.length;

    if (scores_length > 0){

        var new_stats = Object.assign({}, old_stats);

        new_stats.fc_efficiency = 0;
        new_stats.avg_stars = 0;
        new_stats.avg_combo = 0;
        new_stats.avg_length = 0;
        new_stats.avg_accuracy = 0;
        new_stats.total_pp = 0;
        
        var fc_efficiency = [];

        for (let score_id of old_stats.scores_ids){
            let score_info = read_score(score_id);
            fc_efficiency.push(score_info.fc_efficiency);
            new_stats.avg_stars += score_info.stars;
            new_stats.avg_combo += score_info.combo;
            new_stats.avg_length += score_info.beatmap_length;
            new_stats.avg_accuracy += score_info.accuracy*100;
            new_stats.total_pp += score_info.pp;
        }

        fc_efficiency.sort((v1,v2)=>v2-v1);
       
        for (let i in fc_efficiency){
            let weight = (1 - i * weight_multiplier);
            if (weight <= 0) {
                weight = 0;
            }
            new_stats.fc_efficiency += fc_efficiency[i] * weight;
        }

        new_stats.avg_combo /= scores_length;
        new_stats.avg_stars /= scores_length;
        new_stats.avg_length /= scores_length;
        new_stats.avg_accuracy /= scores_length;

        new_stats.fc_efficiency = floor(new_stats.fc_efficiency);
        new_stats.avg_stars = floor(new_stats.avg_stars);
        new_stats.avg_combo = floor(new_stats.avg_combo);
        new_stats.avg_length = floor(new_stats.avg_length,0);
        new_stats.avg_accuracy = floor(new_stats.avg_accuracy);
        new_stats.total_pp = floor(new_stats.total_pp);

        try{
            fs.writeFileSync(path.join(__dirname, 'stats', date), JSON.stringify(new_stats));
        } catch (e){
            console.error(e);
        }

        return new_stats

    }  else {
        return old_stats;
    }

}

const get_daily_stats = async (user_id) => {

    const today = new Date().toJSON().slice(0, 10);
    var daily_stats = get_user_stats(today);  

    var new_scores = await v2.user.scores.category(user_id, 'recent', {mode: score_mode, limit: 100});

    for (let new_score of new_scores){ 
        if (today !== new Date(new_score.created_at).toJSON().slice(0, 10)) continue;

        if (daily_stats.scores_ids.findIndex((val)=>val===new_score.id) === -1){
            const score_info = await get_score_fc_info(new_score);
            if (score_info !== undefined){
                daily_stats.scores_ids.push(new_score.id);
            }
        }
    }

    daily_stats = calculate_stats(daily_stats, today);

    try{
        const yesterday = (new Date((new Date(today)).setDate((new Date(today)).getDate()-1))).toJSON().slice(0, 10);
        var yesterday_stats = fs.readFileSync(path.join(__dirname, 'stats', yesterday.toString() ));
        daily_stats.yesterday_daily = JSON.parse(yesterday_stats);
    } catch (e){
        if (e.code !== 'ENOENT'){
            console.error(e)
        }
    }

    return daily_stats;
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
    
    PathListener(app, '/', 'index.html');
    PathListener(app, '/jquery.min.js', 'jquery.min.js');
    PathListener(app, '/styles.css', 'styles.css');
    PathListener(app, '/favicon.ico', 'favicon.png');
    PathListener(app, '/play.png', 'play.png');
    PathListener(app, '/pause.png', 'pause.png');

    app.post('/get_daily_stats', async (req, res) => {
        var daily_stats = await get_daily_stats(user_id);
        res.send(JSON.stringify(daily_stats));
    });  

    app.post('/get_scores', async (req, res) => {
        var scores_info = [];

        req.body.map(val=>{
            scores_info.push(read_score(val));
        });

        scores_info.sort((val1,val2)=>val2.fc_efficiency - val1.fc_efficiency);
        
        res.send(JSON.stringify(scores_info));
    });  
   
})();