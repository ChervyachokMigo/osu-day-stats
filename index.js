// _ max_pp, screen stats, select day

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

const combo_is_fc = 0.98; //%
const score_mode = 'osu';
const length_significance = 0.1; //0-1
const efficiency_multiplier = 5;
const weight_multiplier = 0.14285714;

const default_stats = {
    fc_efficiency: 0,
    avg_stars: 0,
    avg_combo: 0,
    avg_length: 0,
    avg_accuracy: 0,
    total_pp: 0,
    max_pp: 0,
    max_length: 0,
    max_combo: 0,
    max_stars: 0,

    scores_ids: []
    
}

const check_dir = (dirname) => {
    console.log('Checking directory: ' + dirname)
    try {
        let dir_d = fs.opendirSync(path.join(__dirname, dirname));
        dir_d.closeSync();
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
        console.log('you are logged in.');
        return true;
    } catch (e){
        throw new Error(e);
    }
    
}

const get_user_id = async () => {
    try {
        console.log('reading user id');
        const user_id = fs.readFileSync( path.join(__dirname, 'user_id') );
        console.log('user id: ' + user_id);
        return Number(user_id);
    } catch (e){
        if (e.code === 'ENOENT') {
            try {
                console.log(user_id, 'not found', 'get it from bancho');
                const user_info =  await v2.user.me.details('osu');
                try{
                    console.log('saving user id');
                    fs.writeFileSync( path.join(__dirname, 'user_id' ), user_info.id.toString() );
                } catch (e2){
                    throw new Error(e2);
                }
                console.log('user id: ' + user_info.id);
                return user_info.id;
            } catch (e1){
                throw new Error(e1);
            }
        }
    }
}

const get_user_info = async () => {
    try {
        console.log('reading user profile from bancho')
        const user_info =  await v2.user.me.details('osu');
        return {
            rank: user_info.statistics.global_rank, 
            country_rank: user_info.statistics.country_rank,
            pp: user_info.statistics.pp,
            accuracy: user_info.statistics.hit_accuracy,
            hits: user_info.statistics.total_hits,
            playcount: user_info.statistics.play_count,
            playtime: user_info.statistics.play_time
        }
    } catch (e){
        throw new Error(e);
    }
}

const get_beatmap_info = async (beatmap_id) => {
    console.log('getting beatmap info by id: ' + beatmap_id);
    try {
        console.log('reading beatmap', beatmap_id);
        const beatmap_info = fs.readFileSync(path.join(__dirname, 'beatmaps', beatmap_id.toString() ));
        return JSON.parse(beatmap_info);
    } catch (e) {
        if (e.code === 'ENOENT') {
            try{
                console.log('beatmap not found', beatmap_id, 'get it from bancho');
                const beatmap_info = await v2.beatmap.diff(beatmap_id);
                console.log('saving beatmap');
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
    console.log('getting user stats by date: ' + date);
    var stats = Object.assign({}, default_stats);
    try {
        console.log('reading stats for', date);
        var stats_json = fs.readFileSync(path.join(__dirname, 'stats', date.toString() ));
        stats = JSON.parse(stats_json);
    } catch (e){
        //console.log(e);
    }
    return stats;
}

const save_score_info = async (score) => {
    const beatmap_info = await get_beatmap_info(score.beatmap.id);
    console.log('check score for fc ', score.id);
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
            beatmap_url: `https://osu.ppy.sh/beatmapsets/${beatmap_info.beatmapset_id}#${beatmap_info.mode}/${beatmap_info.id}`,
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
                    console.log('saving score info', score_id);
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

    console.log('calcing daily stats...');
    const scores_length = old_stats.scores_ids.length;

    if (scores_length > 0){
        var scores_info = [];

        var new_stats = Object.assign({}, old_stats);

        new_stats.fc_efficiency = 0;
        new_stats.avg_stars = 0;
        new_stats.avg_combo = 0;
        new_stats.avg_length = 0;
        new_stats.avg_accuracy = 0;
        new_stats.total_pp = 0;
        new_stats.max_pp = 0;
        new_stats.max_length = 0;
        new_stats.max_combo = 0;
        new_stats.max_stars = 0;

        var fc_efficiency = [];

        for (let score_id of old_stats.scores_ids){
            const score_info = read_score(score_id);
            scores_info.push(score_info);
            fc_efficiency.push(score_info.fc_efficiency);
            new_stats.avg_stars += score_info.stars;
            new_stats.avg_combo += score_info.combo;
            new_stats.avg_length += score_info.beatmap_length;
            new_stats.avg_accuracy += score_info.accuracy*100;
            new_stats.total_pp += score_info.pp;
        }

        new_stats.max_pp = Math.max(...array.map(o => o.pp));
        new_stats.max_length = Math.max(...array.map(o => o.beatmap_length));
        new_stats.max_combo = Math.max(...array.map(o => o.combo));
        new_stats.max_stars = Math.max(...array.map(o => o.stars));

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

        return { stats: new_stats, scores: scores_info};

    }  else {
        return { stats: old_stats, scores: []};
    }

}

const get_daily_stats = async () => {
    
    const user_id = await get_user_id();

    console.log('getting daily stats for user ' + user_id);

    const today = new Date().toJSON().slice(0, 10);
    var daily_stats = get_user_stats(today);  

    console.log('request bancho for', 'recent', 'scores of user', user_id);
    console.log('selected mode', score_mode);

    daily_stats.profile_last_update = await get_user_info();

    var new_scores = await v2.user.scores.category(user_id, 'recent', {mode: score_mode, limit: 100});

    for (let new_score of new_scores){ 
        if (today !== new Date(new_score.created_at).toJSON().slice(0, 10)) continue;

        if (daily_stats.scores_ids.findIndex((val)=>val===new_score.id) === -1){
            const score_info = await save_score_info(new_score);
            if (score_info !== undefined){
                daily_stats.scores_ids.push(new_score.id);
            }
        }
    }

    var stats_and_scores = calculate_stats(daily_stats, today);

    try{
        console.log('saving daily stats for', today);
        fs.writeFileSync(path.join(__dirname, 'stats', today), JSON.stringify(stats_and_scores.stats));
    } catch (e){
        console.error(e);
    }

    try{
        let stats_folder = fs.readdirSync(path.join(__dirname, 'stats'));
        if (stats_folder.length > 1){
            const lastday = stats_folder[stats_folder.length-2];
            if (lastday !== today){
                console.log('reading stats for', lastday);
                var lastday_stats = fs.readFileSync(path.join(__dirname, 'stats', lastday.toString() ));
                stats_and_scores.stats.lastday_stats = JSON.parse(lastday_stats);
            }
        }
    } catch (e){
        if (e.code !== 'ENOENT'){
            console.error(e)
        } else {
            console.log('stats not found');
        }
    }

    return stats_and_scores;
}

const main = (async () => {
    console.log('application started');
    if ( ! check_credentials()){
        throw new Error('"osu_login" or "osu_password" are not in environment. Add from "computer settings > environment variables" and relogin winddows.');
    } else {
        console.log('check_credentials complete. logining...');
    }

    if (!await check_login()){
        return;
    }

    app.listen(HTTP_PORT, ()=>{
        console.log(`Scores listening on http://localhost:${HTTP_PORT}`);
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

    app.get('/score', (req, res) => {
        if (req.query === undefined || req.query.day === undefined){
            res.send('error');
            return;
        }
        try {
            let fd = fs.openSync(path.join(__dirname, 'stats', req.query.day ));
            fs.closeSync(fd);
            var stats = get_user_stats(req.query.day)
        res.send(JSON.stringify(stats));
        } catch (e){
            console.log(e);
            res.send('error');
        }
    });

    app.post('/get_daily_stats', async (req, res) => {
        var daily_stats = await get_daily_stats();
        res.send(JSON.stringify(daily_stats));
    });  
   
})();