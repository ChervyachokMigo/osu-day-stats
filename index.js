//## CONSTANTES ##//////////////////////////

//имя игрока, пустая строка - будет использован osu login
var osu_username = '';

//Режим игры
//osu
//taiko
//fruits
//mania
const game_mode = 'osu';

//сколько процентов от максимального комбо скор считается за FC
const combo_is_fc = 0.98; //%

//Значимость длины карты от 0 до 1 (0 - 100%)
const length_significance = 0.1;

//Визуальный параметр, чем выше тем меньше число эфективности
const efficiency_multiplier = 5;

//Коэфициент весов скоров, влияет на суммарный показатель эфективности
//0.14285714 - считает первые 7 скоров в порядке убывания эфективности
//1 место: 1
//2 место: 1 - 0.14285714
//3 место: 1 - 0.28571428
//..
//7 место: 1 - 0.99999998
//следующие места не учитываются (с этим коэфициентом)
//если нужно увеличить количество значимых скоров - уменьшите эту величину
const weight_multiplier = 0.14285714;

//бонусы эфективности за моды
const double_time_bonus = 0.20;
const flashhlight_bonus = 0.25;
const hardrock_bonus = 0.12;
const hidden_bonus = 0.06;
const easy_bonus = -0.12;
const spinout_bonus = -0.03;
const nofail_bonus = -0.05;


///##[CODE]##////////////////////////////////

const fs = require('fs');
const path = require('path');
const { v2, auth } = require('osu-api-extended');

const express = require('express');
const app = express();
const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const HTTP_PORT = 10577;
const webserver_dir = 'web';

const osu_login = process.env.osu_login;
const osu_password = process.env.osu_password;

if (osu_username === '') {
    osu_username = osu_login;
}
console.log('osu_username: ' + osu_username);
console.log('game mode:' + game_mode);

const default_stats = {
    fc_efficiency: 0,
    avg_stars: 0,
    avg_combo: 0,
    avg_length: 0,
    avg_accuracy: 0,
    avg_pp: 0,
    total_pp: 0,
    max_pp: 0,
    max_length: 0,
    max_combo: 0,
    max_stars: 0,
    max_fcp: 0,
    fcp_per_playcount: 0,
    fcp_per_playtime: 0,
    scores_ids: []
}

const default_settings = {
    stats:{
        efficiency: true,
        total_pp: true,
        avg_pp: true,
        fc_count: true,
        avg_stars: true,
        avg_accuracy: true,
        avg_combo: true,
        avg_length: true,
        max_fce: true,
        max_pp: true,
        max_combo: true,
        max_length: true,
        max_stars: true,
        global_rank: true,
        country_rank: true,
        profile_pp: true,
        profile_accuracy: true,
        profile_hits: true,
        profile_playcount: true,
        profile_playtime: true,
        fce_per_playtime: true,
        fce_per_playcount: true
    },
    autoupdate: 0,
}

const check_dir = (...dirname) => {
    let dir = dirname.join(path.sep);
    console.log('Checking directory: ' + dir)
    try {
        let dir_d = fs.opendirSync(path.join(__dirname, dir));
        dir_d.closeSync();
    } catch (e){
        if (e.code === 'ENOENT') {
            try{
                fs.mkdirSync(path.join(__dirname, dir), {recursive: true});
            } catch (e2) {
                throw new Error(e2);
            }
        } else {
            throw new Error(e);
        }
    }
}

check_dir('database', 'beatmaps', game_mode);
check_dir('database', 'scores', game_mode);
check_dir('database', 'stats',  osu_username.toLowerCase(), game_mode);


const promise_timeout = async (promise, timeout) => {
    return new Promise((res, rej)=>{
        setTimeout(()=>{
            console.log(promise);
            rej('timeout error');
        }, timeout);
        res(promise);
    });
}

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
        console.log('try login');

        var token_info =  await auth.login_lazer(osu_login, osu_password);
    
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
        const user_id = fs.readFileSync( path.join(__dirname, 'database', 'stats',  osu_username.toLowerCase(), 'user_id') );
        console.log('founded user id: ' + user_id);
        return Number(user_id);
    } catch (e){
        if (e.code === 'ENOENT') {
            try {
                console.log('user_id', 'not found', 'getting it from bancho..');
                
                const user_info = (osu_username === '')?
                    await v2.user.me.details(game_mode):
                    await v2.user.details(osu_username, game_mode, 'username');

                if (user_info.error === null) {
                    throw new Error ('User '+ osu_username + ' not found.');
                }

                try{
                    console.log('saving user id');
                    fs.writeFileSync( path.join(__dirname, 'database', 'stats',  osu_username.toLowerCase(), 'user_id' ), user_info.id.toString() );
                } catch (e2){
                    throw new Error(e2);
                }

                console.log('used user id: ' + user_info.id);

                return user_info.id;
            } catch (e1){
                throw new Error(e1);
            }
        } else {
            throw new Error(e);
        }
    }
}

const get_user_info = async (user_id) => {
    try {
        console.log('reading user profile from bancho..');

        const user_info = (osu_username === '')?
            await v2.user.me.details(game_mode):
            await v2.user.details(user_id, game_mode, 'id');

        if (user_info.error === null) {
            throw new Error ('User '+ osu_username + ' not found.');
        }

        let rank = user_info.statistics.global_rank;
        let country_rank = user_info.statistics.country_rank;
        let pp  = user_info.statistics.pp;

        if (rank === null){
            rank = 0;
        }
        if (country_rank === null){
            country_rank = 0;
        }
        if (pp === null){
            pp = 0;
        }

        return {
            rank,
            country_rank,
            pp,
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
        const beatmap_info = fs.readFileSync(path.join(__dirname, 'database', 'beatmaps', game_mode, beatmap_id.toString() ));
        return JSON.parse(beatmap_info);
    } catch (e) {
        if (e.code === 'ENOENT') {
            try{
                console.log('beatmap not found', beatmap_id, 'geting it from bancho..');
                const beatmap_info = await v2.beatmap.diff(beatmap_id);
                console.log('saving beatmap');
                fs.writeFileSync(path.join(__dirname, 'database', 'beatmaps', game_mode, beatmap_id.toString() ), JSON.stringify(beatmap_info));
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
        var stats_json = fs.readFileSync(path.join(__dirname, 'database', 'stats',  osu_username.toLowerCase(), game_mode, date.toString() ));
        stats = JSON.parse(stats_json);
    } catch (e){
        console.log('nothing to read', 'set defaults state');
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
        let mods_bonus = 1;

        if (score.mods.length > 0){
            for (let mod of score.mods){
                switch (mod) {
                    case 'FL':
                        mods_bonus += flashhlight_bonus;
                        break;
                    case 'DT':
                        mods_bonus += double_time_bonus;
                        break;
                    case 'HR':
                        mods_bonus += hardrock_bonus;
                        break;  
                    case 'HD':
                        mods_bonus += hidden_bonus;
                        break;
                    case 'EZ':
                        mods_bonus += easy_bonus;
                        break;
                    case 'NF':
                        mods_bonus += nofail_bonus;
                        break;
                    case 'SO':
                        mods_bonus += spinout_bonus;
                        break;
                }
            }
        } else {
            score.mods.push('NM');
        }

        let fc_efficiency = mods_bonus * accuracy * (combo / beatmap_max_combo) *
            ( ((stars * ((beatmap_length / 120) * length_significance) + 
                stars * (1-length_significance))) / 
                    efficiency_multiplier );

        if ( pp === null ){
            pp = 0;
        }

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
            pp,
            beatmap_status: beatmap_info.status,
            mods: score.mods,
            mods_bonus
        }

        try{
            if (!fs.existsSync(path.join(__dirname, 'database', 'scores', game_mode, score_id.toString() ))){
                try{
                    console.log('saving score info', score_id);
                    fs.writeFileSync(path.join(__dirname, 'database', 'scores', game_mode, score_id.toString() ), JSON.stringify(score_fc_info));
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
        var score_json = fs.readFileSync(path.join(__dirname, 'database', 'scores', game_mode, score_id.toString() ));
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
        new_stats.max_fcp = 0;
        new_stats.fcp_per_playcount = 0;
        new_stats.fcp_per_playtime = 0;
        new_stats.avg_pp = 0;

        var fc_efficiency = [];

        var null_pp_count = 0;

        for (let score_id of old_stats.scores_ids){
            var score_info = read_score(score_id);

            if (score_info.pp === 0 || score_info.pp === null ){
                null_pp_count++;
                score_info.pp = 0;
            }
            
            scores_info.push(score_info);
            
            fc_efficiency.push(score_info.fc_efficiency);

            new_stats.avg_stars += score_info.stars;
            new_stats.avg_combo += score_info.combo;
            new_stats.avg_length += score_info.beatmap_length;
            new_stats.avg_accuracy += score_info.accuracy*100;
            new_stats.total_pp += score_info.pp;
            new_stats.avg_pp += score_info.pp;
        }

        new_stats.max_fcp = Math.max(...scores_info.map(o => o.fc_efficiency));
        new_stats.max_pp = Math.max(...scores_info.map(o => o.pp));
        new_stats.max_length = Math.max(...scores_info.map(o => o.beatmap_length));
        new_stats.max_combo = Math.max(...scores_info.map(o => o.combo));
        new_stats.max_stars = Math.max(...scores_info.map(o => o.stars));

        scores_info.sort((s1,s2)=>s2.fc_efficiency-s1.fc_efficiency);
        fc_efficiency.sort((v1,v2)=>v2-v1);
       
        for (let i in fc_efficiency){
            let weight = (1 - i * weight_multiplier);
            if (weight <= 0) {
                weight = 0;
            }
            new_stats.fc_efficiency += fc_efficiency[i] * weight;
        }
        
        let length_with_null_pp = scores_length - null_pp_count;
        if (length_with_null_pp === 0) {
            new_stats.avg_pp = 0;
        } else {
            new_stats.avg_pp /= length_with_null_pp;
        }
        new_stats.avg_combo /= scores_length;
        new_stats.avg_stars /= scores_length;
        new_stats.avg_length /= scores_length;
        new_stats.avg_accuracy /= scores_length;

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

    console.log('requesting bancho for', 'recent', 'scores of user', user_id);
    console.log('selected mode', game_mode);

    daily_stats.profile_last_update = await get_user_info(user_id);

    try{
        var new_scores = await v2.user.scores.category(user_id, 'recent', {mode: game_mode, limit: 100});

        for (let new_score of new_scores){ 
            if (today !== new Date(new_score.created_at).toJSON().slice(0, 10)) continue;

            if (daily_stats.scores_ids.findIndex((val)=>val===new_score.id) === -1){
                const score_info = await save_score_info(new_score);
                if (score_info !== undefined){
                    daily_stats.scores_ids.push(new_score.id);
                }
            }
        }
    } catch (er){
        throw new Error(er);
    }

    var stats_and_scores = calculate_stats(daily_stats, today);

    try{
        console.log('saving daily stats for', today);
        fs.writeFileSync(path.join(__dirname, 'database', 'stats',  osu_username.toLowerCase(), game_mode, today), JSON.stringify(stats_and_scores.stats));
    } catch (e){
        console.error(e);
    }

    try{
        let stats_folder = fs.readdirSync(path.join(__dirname, 'database', 'stats',  osu_username.toLowerCase(), game_mode));
        if (stats_folder.length > 1){
            const lastday = stats_folder[stats_folder.length-2];
            if (lastday !== today){
                console.log('reading stats for', lastday);
                var lastday_stats = fs.readFileSync(path.join(__dirname, 'database', 'stats',  osu_username.toLowerCase(), game_mode, lastday.toString() ));
                stats_and_scores.stats.lastday_stats = JSON.parse(lastday_stats);

                let current_playcount = stats_and_scores.stats.profile_last_update.playcount - stats_and_scores.stats.lastday_stats.profile_last_update.playcount;
                let current_playtime = stats_and_scores.stats.profile_last_update.playtime - stats_and_scores.stats.lastday_stats.profile_last_update.playtime;

                if (current_playcount>0){
                    stats_and_scores.stats.fcp_per_playcount = stats_and_scores.stats.scores_ids.length / current_playcount;
                } else {
                    stats_and_scores.stats.fcp_per_playcount = 0;
                }
               
                if (current_playtime>0){
                    stats_and_scores.stats.fcp_per_playtime = stats_and_scores.stats.scores_ids.length / Math.floor(current_playtime / 60);
                } else {
                    stats_and_scores.stats.fcp_per_playtime = 0;
                }
            }
        }
    } catch (e){
        if (e.code !== 'ENOENT'){
            console.error(e)
        } else {
            console.log('stats not found');
        }
    }

    try{
        console.log('saving daily stats for', today);
        fs.writeFileSync(path.join(__dirname, 'database', 'stats',  osu_username.toLowerCase(), game_mode, today), JSON.stringify(stats_and_scores.stats));
    } catch (e){
        console.error(e);
    }

    return stats_and_scores;
}

const get_settings = () => {
    console.log('getting settings')
    var settings;
    try {
        settings = fs.readFileSync(path.join(__dirname, 'settings.json'));
        settings = JSON.parse(settings);
        return settings;
    } catch (e) {
        if (e.code === 'ENOENT'){
            settings = Object.assign ({}, default_settings);
            save_settings(settings);
            return settings;
        } else {
            throw new Error(e);
        }
    }
}

const save_settings = (settings) => {
    console.log('saving settings');
    try {
        fs.writeFileSync(path.join(__dirname, 'settings.json'), JSON.stringify(settings));
    } catch (e2) {
        throw new Error(e2);
    }
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
    PathListener(app, '/settings.png', 'settings.png');
    PathListener(app, '/html2canvas.min.js', 'html2canvas.min.js');
    PathListener(app, '/save_screen.png', 'save_screen.png');
    
    app.get('/score', (req, res) => {
        if (req.query === undefined || req.query.day === undefined){
            res.send('error');
            return;
        }
        try {
            let fd = fs.openSync(path.join(__dirname, 'database', 'stats',  osu_username.toLowerCase(), game_mode, req.query.day ));
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
        res.send(JSON.stringify({
            username: osu_username,
            gamemode: game_mode,
            stats: daily_stats
        }));
    });

    app.post('/get_settings', (req, res)=>{
        var settings = get_settings();
        res.send(JSON.stringify(settings));
    });

    app.post('/save_settings', (req, res)=>{
        var settings_stats_arr = JSON.parse(req.body.stats);
        var settings = {
            stats: settings_stats_arr,
            autoupdate: req.body.autoupdate
        };
        
        save_settings(settings);
        res.send ('OK');
    });
   
})();