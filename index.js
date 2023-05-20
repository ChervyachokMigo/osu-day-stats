//## CONSTANTES ##//////////////////////////

//сколько процентов от максимального комбо скор считается за FC
const combo_is_fc = 0.98; //%

//Значимость длины карты от 0 до 1 (0 - 100%)
const length_significance = 0.000211;

//Визуальный параметр, чем выше тем меньше число эфективности
const efficiency_multiplier = 1;

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

const electron = require('electron');

const { isFileExists, readdir, check_dir, saveFileSync, loadFileSync } = require('./fileActions.js');

const prompt = async function (question){
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise ( (res, rej) =>{
        readline.question(question, answer => {
            res(answer);
            readline.close();
        });
    });
}

const path = require('path');
const { v2, auth } = require('osu-api-extended');

const express = require('express');
const app = express();
const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const HTTP_PORT = 10577;
const webserver_dir = 'web';
const bancho_request_timeout = 30000;

const osu_client_id = Number(process.env.osu_client_id);
const osu_app_key = process.env.osu_app_key;

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
    osu_username: '',
    osu_userid: 0,
    game_mode: 'osu'
}

var settings;

const path_settings = path.join(__dirname, 'database', 'settings.json');

const promise_timeout = async (promise, timeout = bancho_request_timeout) => {
    console.log('waiting request..')
    return new Promise( async (res, rej)=>{
        setTimeout(()=>{
            rej('timeout error');
        }, timeout);
        let result = await promise;
        res( result );
    });
}

const check_credentials = ()=>{
    if (osu_client_id === undefined || osu_app_key === undefined) return false;
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
    console.log('try login');

    var token_info = await promise_timeout(auth.login(osu_client_id, osu_app_key)).catch(err =>{
        throw new Error(err);
    });

    if (token_info && token_info.access_token === undefined){
        throw new Error('Login failed. Recheck your credentials');
    }

    console.log('you are logged in.');
    return true;

}

const check_userid = async () => {
    if (settings.osu_username === '' || settings.osu_userid == 0){
        settings.osu_username = await prompt('Enter osu username: ');

        if (settings.osu_username === ''){
            throw new Error('You must enter osu username');
        }

        console.log('getting user_info from bancho..');

        const user_info = await promise_timeout(v2.user.details( settings.osu_username, settings.game_mode, 'username'));
    
        if (user_info.error === null) {
            throw new Error ('User not found.');
        }
    
        console.log('Set Username: ', user_info.username);
        console.log('Set User ID: ', user_info.id);

        settings.osu_username = user_info.username;
        settings.osu_userid = user_info.id;
    
        save_settings(settings);
    }
    console.log('used user id:',  settings.osu_userid);
}

const get_user_info = async () => {
    console.log('reading user profile from bancho..');

    const user_info = await promise_timeout(v2.user.details(settings.osu_userid, settings.game_mode, 'id'));

    if (user_info.error === null) {
        throw new Error ('User '+  settings.osu_username + ' not found.');
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
}

const get_beatmap_info = async (beatmap_id) => {
    console.log('getting beatmap info by id: ' + beatmap_id);
    const path_beatmap = path.join(__dirname, 'database', 'beatmaps', settings.game_mode, beatmap_id.toString() );
    var beatmap_info = loadFileSync ( path_beatmap, true );

    if (beatmap_info == null){
        console.log('geting it from bancho..');
        beatmap_info = await promise_timeout(v2.beatmap.diff(beatmap_id));
        if (beatmap_info.error === null) {
            throw new Error ('beatmap '+ beatmap_id + ' not found.');
        }
        saveFileSync(path_beatmap, beatmap_info, true );
    }

    return beatmap_info;
}

const get_user_stats = (date) => {
    console.log('getting user stats by date: ' + date);
    const path_stats_date = path.join(__dirname, 'database', 'stats',   settings.osu_username.toLowerCase(), settings.game_mode, date.toString() );
    var stats = loadFileSync( path_stats_date, true );
    if (stats == null) {
        console.log('nothing to read, set defaults state');
        stats = Object.assign({}, default_stats);
    }
    return stats;
}

const save_score_info = async (score) => {
    const path_score = path.join(__dirname, 'database', 'scores', settings.game_mode, score.id.toString() )
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

    position = score.position;
    statistics = score.statistics;
    ar = score.beatmap.ar;
    cs = score.beatmap.cs;
    count_circles = score.beatmap.count_circles;
    count_sliders = score.beatmap.count_sliders;
    count_spinners = score.beatmap.count_spinners;


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

        let length_value =  1 + Math.log(1 + (beatmap_length * length_significance) );

        let fc_efficiency = mods_bonus * accuracy * (combo / beatmap_max_combo) *
        ( length_value * stars ) * efficiency_multiplier ;

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
            mods_bonus,
            position,
            statistics,
            ar,
            cs,
            count_circles,
            count_sliders,
            count_spinners,
        }

        if ( ! isFileExists(path_score) ){
            console.log('saving score info', score_id);
            saveFileSync(path_score, score_fc_info, true)
        }

        return score_fc_info;
    } else {
        return undefined;
    }
}

const read_score = (score_id) => {
    const path_score = path.join(__dirname, 'database', 'scores', settings.game_mode, score_id.toString() );
    return loadFileSync(path_score, true);
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

    const today = new Date().toJSON().slice(0, 10);

    const path_stats_today = path.join( __dirname, 'database', 'stats',   settings.osu_username.toLowerCase(), settings.game_mode, today );

    console.log('getting daily stats for user', settings.osu_userid);
    var daily_stats = get_user_stats(today);  

    console.log('requesting bancho for recent scores of user', settings.osu_userid);
    console.log('selected mode', settings.game_mode);

    daily_stats.profile_last_update = await get_user_info();

    console.log('getting scores from bancho..' );
    var new_scores = await promise_timeout(v2.user.scores.category(settings.osu_userid, 'recent', {mode: settings.game_mode, limit: 100})).catch( err => {
        throw new Error(err);
    });

    if (new_scores.error === null) {
        throw new Error ('scores request error.');
    }

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

    console.log('saving daily stats for', today);
    saveFileSync(path_stats_today, stats_and_scores.stats, true);    

    const path_stats = path.join(__dirname, 'database', 'stats',   settings.osu_username.toLowerCase(), settings.game_mode);
    let stats_folder = readdir( path_stats );

    if (stats_folder.length > 1){

        const lastday = stats_folder[stats_folder.length-2];
        const path_stats_lastday = path.join(__dirname, 'database', 'stats',   settings.osu_username.toLowerCase(), settings.game_mode, lastday.toString() );

        if (lastday !== today){

            console.log('reading stats for', lastday);
            stats_and_scores.stats.lastday_stats = loadFileSync(path_stats_lastday, true);

            if (stats_and_scores.stats.lastday_stats !== null) {
                let current_playcount = stats_and_scores.stats.profile_last_update.playcount - stats_and_scores.stats.lastday_stats.profile_last_update.playcount;
                let current_playtime = stats_and_scores.stats.profile_last_update.playtime - stats_and_scores.stats.lastday_stats.profile_last_update.playtime;

                if (current_playcount > 0){
                    stats_and_scores.stats.fcp_per_playcount = stats_and_scores.stats.scores_ids.length / current_playcount;
                } 
                
                if (current_playtime > 0){
                    stats_and_scores.stats.fcp_per_playtime = stats_and_scores.stats.scores_ids.length / Math.floor(current_playtime / 60);
                }

                console.log('saving updated daily stats for', today);
                saveFileSync(path_stats_today, stats_and_scores.stats, true);

            }

        }
    } else {
        console.log('stats are only one day')
    }

    return stats_and_scores;
}

const check_setting = (data, value) => {
    console.log('check setting', value);
    if (!data[value]){
        data[value] = default_settings[value];
        console.log('value not found. set to default');
        return true;
    }
    return false;
}

const get_settings = () => {
    console.log('getting settings..')
    var data = loadFileSync( path_settings , true );
    if (data == null) {
        data = Object.assign ({}, default_settings);
        save_settings(data);
    }
    if (check_setting(data, 'osu_username') ){
        save_settings(data);
    }
     if (check_setting(data, 'osu_userid') ){
        save_settings(data);
     }
     if (check_setting(data, 'game_mode') ){
        save_settings(data);
     }
     if (check_setting(data, 'autoupdate') ) {
        save_settings(data);
    }
    return data;
}

const save_settings = (data) => {
    console.log('saving settings..');
    saveFileSync (path_settings, data, true);
}

const main = (async () => {
    console.log('application started');

    const is_change_username = process.argv.slice(2).findIndex( val => val === 'change_username')  > -1;
    const is_change_gamemode = process.argv.slice(2).findIndex( val => val === 'change_gamemode')  > -1;

    settings = get_settings();

    if (is_change_username){
        settings.osu_username = '';
        settings.osu_userid = 0;
    }

    if (is_change_gamemode) {
        console.log('Type number of gamemode:')
        console.log('0 - osu\n1 - taiko\n2 - catch the beat\n3 - mania');
        settings.game_mode = Number(await prompt('Select gamemode. Enter number: '));

        if (isNaN(settings.game_mode) || settings.game_mode < 0 || settings.game_mode > 3){
            console.log('Invalid gamemode value: ', settings.game_mode);
            return;
        }

        switch (settings.game_mode){
            case 0: settings.game_mode = 'osu'; break;
            case 1: settings.game_mode = 'taiko'; break;
            case 2: settings.game_mode = 'fruits'; break;
            case 3: settings.game_mode = 'mania'; break;
            default: //nothing
        }

        save_settings(settings);

        console.log('Selection of gamemode complete.\n', 'You choose the', settings.game_mode, 'gamemode');

        return;
    }

    check_dir('database', 'beatmaps', settings.game_mode);
    check_dir('database', 'scores', settings.game_mode);
    check_dir('database', 'stats',  settings.osu_username.toString(), settings.game_mode);

    if ( ! check_credentials()){
        throw new Error('"osu_client_id" or "osu_app_key" are not in environment. Add from "computer settings > environment variables" and relogin winddows.');
    } else {
        console.log('check_credentials complete. logining...');
    }

    if (!await check_login()){
        return;
    }

    await check_userid();

    if (is_change_username){
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
        const path_stats_query_day = path.join(__dirname, 'database', 'stats',  (settings.osu_username).toLowerCase(), settings.game_mode, req.query.day );

        if (req.query === undefined || req.query.day === undefined){
            res.send('error');
            return;
        }

        if ( ! isFileExists (path_stats_query_day)){
            res.send('error');
            return;
        }
        
        var stats = get_user_stats(req.query.day);
        res.send(JSON.stringify(stats));
      
    });

    app.post('/get_daily_stats', async (req, res) => {
        var daily_stats = await get_daily_stats();
        res.send(JSON.stringify({
            username: settings.osu_username,
            gamemode: settings.game_mode,
            stats: daily_stats
        }));
    });

    app.post('/get_settings', (req, res)=>{
        res.send(JSON.stringify(settings));
    });

    app.post('/save_settings', (req, res)=>{
        settings.stats = JSON.parse(req.body.stats);
        settings.autoupdate = req.body.autoupdate;        
        save_settings(settings);
        res.send ('OK');
    });

    function createWindow() {
        const win = new electron.BrowserWindow({
          width: 1280,
          height: 768,
          webPreferences: {
            nodeIntegration: true
          }
        });
        win.loadURL('http://localhost:'+HTTP_PORT+"/")
      }
      
      electron.app.whenReady().then(() => {
        createWindow();
      
        electron.app.on('activate', () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
          }
        });
      });
      
      electron.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            electron.app.quit();
        }
      });
   
})();