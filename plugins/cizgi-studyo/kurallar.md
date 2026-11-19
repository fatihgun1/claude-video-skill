# Çizgi Stüdyo: temel kurallar

Every skill of this plugin and the editor panel follow these. Whichever way the work began (a skill, the panel, a hook message), read this file before writing or changing a scene. The skills give the details; `cizgi dogrula` checks most of what can be checked, and an open warning holds the approval gates until it is fixed or the person keeps it (`cizgi uyari-kabul … --neden`).

## The person decides
1. Write each wish of the person into `hikaye.json` `kisi` in their own words (`yap`, `yapma` or `sor`), and answer every `sor` before the script gate.
2. Do not change the person's story or lines on your own. Fix what the engine reports; ask about anything else.
3. A shot the person locked (`shot.kilit`) is theirs: leave it as it is.
4. Questions go in the chat, choices in the panel: one `panel_sor` at a time. Keep a chat message to about six lines; tables and stills go to the panel.
5. While the panel is open, start the watcher (`bekci` from `panel_ac`) in the background at the end of every turn.

## Show what happens
6. Every event of the story happens on screen: a thing is picked up (`grab`), put away (`release`), set down (`put_down`, `sonra`) or handed over (`to`). Nothing appears or vanishes between shots, and nothing multiplies.
7. Break a scene into shots: an establishing shot, closer shots on who acts and speaks, an insert on the thing that matters. Use more than one angle of a place (`shot.bg`), shot / reverse shot or over the shoulder in a conversation. While one person speaks, the listener does something.
8. A job with its own place (the scale, the table) gets its own angle, not a scene in the middle of another one.
9. Mark a jump in time on the first shot after it (`zaman_atlama`). The time of day (`isik`) and what people hold carry over every other cut.
10. In 9:16 people stand closer together. Check both formats: nobody is drawn over another person, nobody's head is cut, and nobody walks through someone.

## Draw the place, not the people
11. A background is the place only. People are characters (or a moving crowd decor); anything the story could use is a prop. A draft that names a person or a usable thing is refused.
12. The far layer is drawn too (rooftops, trees, buildings), with its own skyline for each place. An outdoor scene has at least two moving pieces (`dekor[].akis`).
13. A new action is tried on the drawings it is made for (`for`). At every key the lower foot stands on the ground, unless the body rests on something else (`temas`: oturma, yatma, havada).

## Sound
14. Tie an effect to what makes it: a line or word (`replik`, `kelime`), a moment of an action (`oyuncu` + `an`), or a walk (`oyuncu` + `adim`). Use `at` only for a sound that nothing on screen makes.
15. Every speaker has a chosen voice. The narrator's voice is distinct from the characters'. Never record over the person's own recording (`utterance.audio`).

## Gates
16. Script (`senaryo`) → audio → storyboard → render. Each step needs the one before it to be approved.
17. Storyboard approval covers only what the person saw. After any change, take new stills (`cizgi storyboard`), show them, then approve.
18. Only the person approves. Record a gate (`cizgi onayla`) or keep a warning (`cizgi uyari-kabul`) only after they say yes in their own words.
