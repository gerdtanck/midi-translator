# Elektron Machinedrum Midi Translator

We are implementing a web based midi translator 

The goal is to play the Elektron Machinedrum polyphonically using its polyphonic machines.
The translator will receive midi notes on the input device and translate them into midi notes and cc messages on the output device. 
A polyphonic machine on the Machinedrum receives its trigger through a specific note on channel 1 and its pitches via cc messages on channel 1 - 4, depending on which group it is in.

## Track triggering

A track on the machinedrum is triggered by sending a note on midi channel 1:

Track Note

1     c2
2     d2
3     e2
4     f2
5     g2
6     a2  
7     b2
8     c3
9     d3
10    e3  
11    f3
12    g3
13    a3
14    b3
15    c3
16    d4

## Controlling track machine parameters with midi CCs

When sending ccs, the midi channel decides which group of tracks will recieive the ccs:

         Channel 1 | Channel 2 | Channel 3  | Channel 4  
Tracks   1 2 3 4   | 5 6 7 8   | 9 10 11 12 | 13 14 15 16 

## Controlling machine pitches with midi CCs

The ccs that control the pitches of the machines four machines in a group are the same for each group:

First machine
PTCH1:   cc16
PTCH2:   cc20
PTCH3:   cc21
PTCH4:   cc22
DEC:     cc17

Second machine
PTCH1:   cc40
PTCH2:   cc44
PTCH3:   cc45
PTCH4:   cc46
DEC:     cc41

Third machine
PTCH1:   cc72
PTCH2:   cc76
PTCH3:   cc77
PTCH4:   cc78
DEC:     cc73

Fourth machine
PTCH1:   cc96
PTCH2:   cc100
PTCH3:   cc101
PTCH4:   cc102
DEC:     cc97

## Polyphonic machines TONAL mode

The manual says "TONAL" tuning implements a quater-tone equal tempered tuning scale across the PTCH
parameter of selected machines. 

Machinedrum Tonal Chart (GND-PU, GND-SW): 

0 C#/D♭1 (34.65 Hz) 
2 D 66 B♭ 
4 D#/E♭ 68 B3 
6 E 70 C4(261.63 Hz) 
8 F1 72 D♭ 
10 F#/G♭ 74 D4 
12 G 76 E♭ 

...

110 A♭ 48 D♭ 
112 A5(880 Hz) 50 D 
114 B♭ 52 E♭ 
116 B5 54 E3 
118 C6(1046.50) 
120 D♭ 58 G♭ 
122 D 60 G3 
124 E♭ 62 A♭ 
126 E6(1318.51)

## UI of the application

The UI of the translator application displays a web page.
When the page is loaded, the user is asked to select the midi input and output device.
The user can select track 1 to 16 to be controlled by the translator.
The user can select if the track shall receive cc messages for a polyphony of 1, 3 or 4.





