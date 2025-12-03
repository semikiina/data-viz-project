# hi


## run with

python -m http.server 8000  

http://localhost:8000/


## To-Do(ish)

fix league_name values in pcp to not hide...

add weighted sum. this way the user can manually select which attributes he cares about to see which teams match. for example if we select defenceAggression with  weight 1
and defencePressure  with weight 1, we get all teams with similar defence strategies. Could be interesting to look into... look at the example https://parasoljs.github.io/demo/paper-example-3.html to see how this could make sense in our case. not 100% we need to add this but could be kinda cool.

figure out what to do with the data that has value 0? either removes these rows or calculate a mean value here is my best suggestions

improve overall css (make the full page non-scrollable, align divs, ect.)

better colors for highlighted labels in heatmap - make the attributes look more 'clickable'? add 'Select All Attributes' and 'Clear All Attributes'?

when you select teams in the bottom table, these teams should  be remembered when you select other  leagues and attributes in the matrix

maybe adjust colors and brightness in pcp when selecting  only a few leagues (maybe add a slider so the user manually can increase the color brightness)

make the pcp remember the curve smoothness and bundling strength when you change attributes in the matrix




