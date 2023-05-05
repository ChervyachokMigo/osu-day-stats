$.ajax({
    url: '/get_scores',
    type: 'POST',
    dataType: 'json',
    data: JSON.stringify(scores_ids),
    contentType: 'application/json; charset=utf-8',
    success: (scores_info) => {
        $('.all_scores').empty();
        for (score of scores_info){
            $('.all_scores').append(score_element(score));
        }
        paint_lastday_compare_text();
    },
    error: (error) => console.log(error)
});

app.post('/get_scores', async (req, res) => {

    var scores_info = [];

    if (typeof req.body === 'undefined') {
        res.send(JSON.stringify(scores_info));
        return;
    }

    console.log('getting', req.body.length, 'scores');

    req.body.map(val=>{
        scores_info.push(read_score(val));
    });

    scores_info.sort((val1,val2)=>val2.fc_efficiency - val1.fc_efficiency);

    console.log('sending',scores_info.length,'scores');

    res.send(JSON.stringify(scores_info));
});  