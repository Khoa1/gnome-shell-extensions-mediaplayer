/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/* jshint esnext: true */
/* jshint -W097 */
/* jshint multistr: true */
/* global imports: false */
/**
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 **/

'use strict';

const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Atk = imports.gi.Atk;
const BoxPointer = imports.ui.boxpointer;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const Tweener = imports.ui.tweener;
const Gettext = imports.gettext.domain('gnome-shell-extensions-mediaplayer');
const _ = Gettext.gettext;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Settings = Me.imports.settings;
const Util = Me.imports.util;
const DBusIface = Me.imports.dbus;
const GObject = imports.gi.GObject
const Signals = imports.signals;

const shellMinorVersion = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[1]);

var SubMenu = class SubMenu extends PopupMenu.PopupMenuBase{
  constructor(sourceActor, sourceArrow, isPlayerMenu) {
    super(sourceActor);
    this._isPlayerMenu = isPlayerMenu;
    this._arrow = sourceArrow;

    this.actor = new St.ScrollView({style_class: 'popup-sub-menu',
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.NEVER});

    this.actor.add_actor(this.box);
    this.actor._delegate = this;
    this.actor.clip_to_allocation = true;
    this.actor.connect('key-press-event', this._onKeyPressEvent.bind(this));
    this.actor.hide();
  }

  _needsScrollbar() {
    let topMenu = this._getTopMenu();
    let [topMinHeight, topNaturalHeight] = topMenu.actor.get_preferred_height(-1);
    let topThemeNode = topMenu.actor.get_theme_node();

    let topMaxHeight = topThemeNode.get_max_height();
    return topMaxHeight >= 0 && topNaturalHeight >= topMaxHeight;
  }

  getSensitive() {
    return this._sensitive && this.sourceActor._delegate.getSensitive();
  }

  open() {
    if (this.isOpen || this.isEmpty())
      return;

    this.isOpen = true;
    this.emit('open-state-changed', true);
    this.actor.show();

    let needsScrollbar = this._needsScrollbar();

    if (needsScrollbar && !this._isPlayerMenu) {
      this.actor.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
      this.actor.add_style_pseudo_class('scrolled');
    } else {
      this.actor.vscrollbar_policy = Gtk.PolicyType.NEVER;
      this.actor.remove_style_pseudo_class('scrolled');
    }

    this._arrow.rotation_angle_z = this.actor.text_direction == Clutter.TextDirection.RTL ? -90 : 90;
  }

  close() {
    if (!this.isOpen || this.isEmpty())
      return;

    this.isOpen = false;
    this.emit('open-state-changed', false);

    if (this._activeMenuItem)
      this._activeMenuItem.setActive(false);
    this._arrow.rotation_angle_z = 0;
    this.actor.hide();
  }

  _onKeyPressEvent(actor, event) {
    // Move focus back to parent menu if the user types Left.

    if (this.isOpen && event.get_key_symbol() == Clutter.KEY_Left) {
      this.close(BoxPointer.PopupAnimation.FULL);
      this.sourceActor._delegate.setActive(true);
      return Clutter.EVENT_STOP;
    }

    return Clutter.EVENT_PROPAGATE;
  }
}
if (shellMinorVersion >= 999) { // not for 3.34.5 yet
  SubMenu = GObject.registerClass(
    {GTypeName: 'SubMenu'},
    SubMenu
  );
}
Signals.addSignalMethods(SubMenu.prototype);

var PlayerMenu = class PlayerMenu extends PopupMenu.PopupSubMenuMenuItem{
  _init(label, wantIcon) {
    log("=== TESTING ===")
    super._init(label, wantIcon)
    this._playStatusIcon = new St.Icon({style_class: 'popup-menu-icon'});
    this.actor.insert_child_at_index(this._playStatusIcon, 3);
    this.menu = new SubMenu(this.actor, this._triangle, true);
    this.menu.connect('open-state-changed', this._subMenuOpenStateChanged.bind(this));
  }
  constructor(label, wantIcon) {
    super(label, wantIcon);
    if (shellMinorVersion < 34) {
      this._init(label, wantIcon)
    }
  }

  addMenuItem(item) {
    this.menu.addMenuItem(item);
  }

  setPlayStatusIcon(icon) {
    this._playStatusIcon.icon_name = icon;
  }

  hidePlayStatusIcon() {
    this._playStatusIcon.hide();
  }

  showPlayStatusIcon() {
    this._playStatusIcon.show();
  }
}
if (shellMinorVersion >= 34) {
  PlayerMenu = GObject.registerClass(
    {GTypeName: 'PlayerMenu'},
    PlayerMenu
  );
}



var BaseContainer = class BaseContainer extends PopupMenu.PopupBaseMenuItem {
  constructor(parms) {
    if (shellMinorVersion >= 34) {
      super(parms);
    } else {
      super(parms);
      this._init(parms);
    }
  }
  _init(parms) {
    super._init(parms);
    this._hidden = false;
    this._animating = false;
    //We don't want our BaseContainers to be highlighted when clicked,
    //they're not really menu items in the traditional sense.
    //We want to maintain the illusion that they are normal UI containers,
    //and that our main track UI area is one big container.
    this.actor.add_style_pseudo_class = function() {return null;};
  }

  get hidden() {
    return this._hidden;
  }

  set hidden(value) {
    this._hidden = value;
  }

  get animating() {
    return this._animating;
  }

  set animating(value) {
    this._animating = value;
  }

  hide() {
    /*this.actor.hide();*/
    this.actor.opacity = 0;
    this.actor.set_height(0);
    this.hidden = true;
  }

  show() {
    /*this.actor.show();*/
    this.actor.opacity = 255;
    this.actor.set_height(-1);
    this.hidden = false;
  }

  showAnimate() {
    this.show();
    // khoa1: tweener removed for now in BaseContainer and Info, and extracted out onComplete() functions
    //
    // This solves vlc not showing its info labels upon new vlc instance being opened. I guess no animation as tradeoff.
    //
    // Hiding/showing does not work using tweener... atleast for Info in ui.js. For some reason. I don't know yet.
    //
    // But in Info, tweener is found to... somehow reset the value of its labels as empty string. 
    // I've traced as much as I can, and cannot find the source of the value change. This reset
    // occurs in _hideAnimateInfoItem, when tweening's onComplete() is called. 
    // Unexpected value reset Occurs BETWEEN the END of _titleLabel, and BEGINING of _albumLabel... 
    // despite supposedly being back to back. Perhaps scope problem? Idk.
    //
    // Still debuging this. Bit of a nightmare.

    /*
    if (!this.actor.get_stage() || !this._hidden || this.animating) {
      return;
    }
    this.animating = true;
    this.actor.set_height(-1);
    let [minHeight, naturalHeight] = this.actor.get_preferred_height(-1);
    this.actor.set_height(0);
    this.actor.show();
    Tweener.addTween(this.actor, {
      opacity: 255,
      height: naturalHeight,
      time: 0.25,
      onComplete() {
        this.show();
        this.animating = false;
      },
      onCompleteScope: this
    });
    */
  }

  hideAnimate() {
    this.hide();
    /*
    if (!this.actor.get_stage() || this._hidden || this.animating) {
      return;
    }
    this.animating = true;
    Tweener.addTween(this.actor, {
      opacity: 0,
      height: 0,
      time: 0.25,
      onComplete() {
        this.hide();
        this.animating = false;
      },
      onCompleteScope: this
    });
    */
  }
}
if (shellMinorVersion >= 34) {
  BaseContainer = GObject.registerClass(
    {GTypeName: 'BaseContainer'},
    BaseContainer
  );
}


var PlayerButtons = class PlayerButtons extends BaseContainer {
  constructor() {
    if (shellMinorVersion >= 34) {
      super();
    } else {
      super({hover: false});
      this._init();
    }
  }
  _init() {
    super._init({hover: false});
    this.box = new St.BoxLayout({style_class: 'no-padding-bottom player-buttons'});
    this.actor.add(this.box, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
  }
  addButton(button) {
    this.box.add(button.actor, {expand: false});
  }
}
if (shellMinorVersion >= 34) {
  PlayerButtons = GObject.registerClass(
    {GTypeName: 'PlayerButtons'},
    PlayerButtons
  );
}

var ShuffleLoopStatus = class ShuffleLoopStatus extends BaseContainer {
  constructor(player) {
    if (shellMinorVersion >= 34) {
      super(player);
    } else {
      super({hover: false});
      this._init(player);
    }
  }

  _init(player) {
    if(shellMinorVersion >= 34)
      super._init({hover: false});
    this._player = player;
    this.box = new St.BoxLayout({style_class: 'no-padding-bottom no-padding-top'});
    this.actor.add(this.box, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
    let shuffleIcon = new St.Icon({icon_name: 'media-playlist-shuffle-symbolic', style_class: 'popup-menu-icon'});
    this._shuffleButton = new St.Button({child: shuffleIcon});
    this._setButtonActive(this._shuffleButton, false);
    this._shuffleButton.connect('notify::hover', this._onButtonHover.bind(this));
    this._shuffleButton.connect('clicked', () => {
      this._player.shuffle = this._player.state.shuffle ? false : true;
    });
    this.box.add(this._shuffleButton);
    let repeatIcon = new St.Icon({icon_name: 'media-playlist-repeat-song-symbolic', style_class: 'popup-menu-icon'});
    this._repeatButton = new St.Button({child: repeatIcon});
    this._setButtonActive(this._repeatButton, false);
    this._repeatButton.connect('notify::hover', this._onButtonHover.bind(this));
    this._repeatButton.connect('clicked', () => {
      this._player.loopStatus = this._player.state.loopStatus == 'Track' ? 'None' : 'Track';
    });
    this.box.add(this._repeatButton);
    let repeatAllIcon = new St.Icon({icon_name: 'media-playlist-repeat-symbolic', style_class: 'popup-menu-icon'});
    this._repeatAllButton = new St.Button({child: repeatAllIcon});
    this._setButtonActive(this._repeatAllButton, false);
    this._repeatAllButton.connect('notify::hover', this._onButtonHover.bind(this));
    this._repeatAllButton.connect('clicked', () => {
      this._player.loopStatus = this._player.state.loopStatus == 'Playlist' ? 'None' : 'Playlist';
    });
    this.box.add(this._repeatAllButton);
  }

  setLoopStaus (loopStatus) {
    if (loopStatus == 'None') {
      this._setButtonActive(this._repeatButton, false);
      this._setButtonActive(this._repeatAllButton, false);
    }
    else if (loopStatus == 'Track') {
      this._setButtonActive(this._repeatButton, true);
      this._setButtonActive(this._repeatAllButton, false);
    }
    else if (loopStatus == 'Playlist') {
      this._setButtonActive(this._repeatButton, false);
      this._setButtonActive(this._repeatAllButton, true);
    }
  }

  setShuffle (shuffle) {
    this._setButtonActive(this._shuffleButton, shuffle);
  }

  _setButtonActive (button, active) {
    button._isActive = active;
    button.opacity = active ? 204 : 102;
  }

  _onButtonHover (button) {
    button.opacity = button.hover ? 255 : button._isActive ? 204 : 102;
  }
}
if (shellMinorVersion >= 34) {
  ShuffleLoopStatus = GObject.registerClass(
    {GTypeName: 'ShuffleLoopStatus'},
    ShuffleLoopStatus
  );
}

var PlaylistTitle = class PlaylistTitle extends BaseContainer {
  _init () {
    super._init({hover: false, style_class: 'no-padding-bottom'});
    this._label = new St.Label({style_class: 'track-info-artist'});
    this.actor.add(this._label, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
  }

  update(name) {
    if (name && this._label.text != name) {
      this._label.text = name;
    }
  }
}
if (shellMinorVersion >= 34) {
  PlaylistTitle = GObject.registerClass(
    {GTypeName: 'PlaylistTitle'},
    PlaylistTitle
  );
}


var PlayerButton = class PlayerButton {
  constructor(icon, callback) {
    this.actor = new St.Button({child: new St.Icon({icon_name: icon})});
    this.actor.opacity = 204;
    this.actor._delegate = this;
    this.actor.connect('clicked', callback);
    this.actor.connect('notify::hover', (button) => {
      this.actor.opacity = button.hover ? 255 : 204;
    });
  }

  setIcon(icon) {
    this.actor.child.icon_name = icon;
  }

  setIconSize(style) {
    if (style == Settings.ButtonIconStyles.CIRCULAR) {
      this.actor.child.style_class = null;
      this.actor.style_class = 'system-menu-action';
    }
    else if (style == Settings.ButtonIconStyles.SMALL) {
      this.actor.style_class = null;
      this.actor.child.style_class = 'popup-menu-icon';
    }
    else if (style == Settings.ButtonIconStyles.MEDIUM) {
      this.actor.style_class = null;
      this.actor.child.style_class = 'nm-dialog-header-icon medium-player-button';
    }
    else if (style == Settings.ButtonIconStyles.LARGE) {
      this.actor.style_class = null;
      this.actor.child.style_class = 'shell-mount-operation-icon large-player-button';
    }
  }

  enable() {
    this.actor.reactive = true;
    this.actor.opacity = 204;
  }

  disable() {
    this.actor.reactive = false;
    this.actor.opacity = 102;
  }

  hide() {
    this.actor.hide();
  }

  show() {
    this.actor.show();
  }
}

var SliderItem = class SliderItem extends BaseContainer {
  constructor(icon) {
    if (shellMinorVersion >= 34) {
      super(icon);
    } else {
      super({hover: false});
      this._init(icon);
    }
  }
  _init(icon) {
    super._init({hover: false});
    this._icon = new St.Icon({style_class: 'popup-menu-icon', icon_name: icon});
    this._slider = new Slider.Slider(0);
    this.actor.add(this._icon);
    this.actor.add(this._slider, {expand: true});
  }

  get isDragging() {
    return this._slider._dragging;
  }

  setReactive(reactive) {
    this._slider.reactive = reactive;
  }

  setValue(value) {
    this._slider.value = value;
  }

  setIcon(icon) {
    this._icon.icon_name = icon;
  }

  sliderConnect(signal, callback) {
    return this._slider.connect(signal, callback);
  }
}
if (shellMinorVersion >= 34) {
  SliderItem = GObject.registerClass(
    {GTypeName: 'SliderItem'},
    SliderItem
  );
}

var TrackCover = class TrackCover extends BaseContainer {
  constructor(icon) {
    if (shellMinorVersion >= 34) {
      super(icon);
    } else {
      super({hover: false, style_class: 'no-padding-bottom'});
      this._init(icon);
    }
  }
  _init(icon) {
    super._init({hover: false, style_class: 'no-padding-bottom'});
    this.icon = icon;
    this.actor.add(this.icon, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
  }
}
if (shellMinorVersion >= 34) {
  TrackCover = GObject.registerClass(
    {GTypeName: 'TrackCover'},
    TrackCover
  );
}

var Info = class Info extends BaseContainer {
  constructor() {
    if (shellMinorVersion >= 34) {
      super();
    } else {
      super({hover: false, style_class: 'no-padding-bottom'});
      this._init();
    }
  }
  _init() {
    super._init({hover: false, style_class: 'no-padding-bottom'});
    this._animateChange = Util.animateChange;     
    this.infos = new St.BoxLayout({vertical: true});
    this._artistLabel = new St.Label({style_class: 'track-info-artist'});
    this._titleLabel = new St.Label({style_class: 'track-info-title'});
    this._albumLabel = new St.Label({style_class: 'track-info-album'});
    this.infos.add(this._artistLabel, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
    this.infos.add(this._titleLabel, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
    this.infos.add(this._albumLabel, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
    this.actor.add(this.infos, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
  }

  update(state) {
    this._setInfoText(this._artistLabel, state.trackArtist);
    // khoa1: I prefer url if trackTitle doesn't exist, may add pref option to select once I figure out how.
    let trackTitleOrUrl = state.trackTitle.length != 0 ? state.trackTitle :decodeURIComponent(state.trackUrl.split('/').reverse()[0]);
    this._setInfoText(this._titleLabel, trackTitleOrUrl);
    this._setInfoText(this._albumLabel, state.trackAlbum);
  }

  _setInfoText(actor, text) {
    if (text) {
      if (actor.text != text) {
        this._showAnimateInfoItem(actor, text);
      }
    }
    else {
      this._hideAnimateInfoItem(actor, text);
    }
  }

  _hideInfoItem(actor) {
    actor.hide();
    actor.opacity = 0;
    actor.set_height(0);
  }

  _showInfoItem(actor) {
    actor.show();
    actor.opacity = 255;
    actor.set_height(-1);
  }

  _showAnimateInfoItem(actor, text) {
    if (actor.visible && !this.animating) {
      this._animateChange(actor, 'text', text);
    }
    else if (this.animating) {
      actor.text = text;
      this._showInfoItem(actor);
    }
    else {
      actor.text = text;
      actor.set_height(-1);
      let [minHeight, naturalHeight] = actor.get_preferred_height(-1);
      actor.set_height(0);
      actor.show();
      this._showInfoItem(actor);
      /*
      Tweener.addTween(actor, {
        height: naturalHeight,
        time: 0.25,
        opacity: 255,
        onComplete() {
          this._showInfoItem(actor);
        },
        onCompleteScope: this
      });
      */
    }
  }

  _hideAnimateInfoItem(actor, text) {
    if (!actor.visible && !this.animating) {
      actor.text = text;
    }
    else if (this.animating) {
      this._hideInfoItem(actor);
      actor.text = text;
    }
    else {
      this._hideInfoItem(actor);
      actor.text = text;
      /*
      Tweener.addTween(actor, {
        height: 0,
        time: 0.25,
        opacity: 0,
        onComplete() {
          this._hideInfoItem(actor);
          actor.text = text;
        },
        onCompleteScope: this
      });
      */
    }
  }
}
if (shellMinorVersion >= 34) {
  Info = GObject.registerClass(
    {GTypeName: 'Info'},
    Info
  );
}


var TrackRating = class TrackRating extends BaseContainer {
  constructor(player, value) {
    if (shellMinorVersion >= 34) {
      super(player, value);
    } else {
      super({style_class: 'no-padding-bottom', hover: false});
      this._init(player, value);
    }
  }
  _init(player, value) {
    super._init({style_class: 'no-padding-bottom', hover: false});

    this._hidden = false;
    this._player = player;
    this._animateChange = Util.animateChange;

    this.box = new St.BoxLayout({style_class: 'no-padding track-info-album'});
    this.actor.add(this.box, {expand: true, x_fill: false, x_align: St.Align.MIDDLE});
    this._applyFunc = null;
    this._value = null;
    this._isNuvolaPlayer = false;
    this._rhythmbox3Proxy = false;
    if (this._player._pithosRatings) {
      this.rate = this._ratePithos;
      this._buildPithosRatings();
    }
    else {
      if (this._player._ratingsExtension) {
        this._applyFunc = this.applyRatingsExtension;
      }
      else {
        this._isNuvolaPlayer = this._player.busName.indexOf("org.mpris.MediaPlayer2.NuvolaApp") != -1;
        if (this._isNuvolaPlayer) {
          this._applyFunc = this.applyNuvolaRating;
        }
        else {
          // Supported players (except for Nuvola Player & Pithos)
          let supported = {
            "org.mpris.MediaPlayer2.rhythmbox": this.applyRhythmbox3Rating,
            "org.mpris.MediaPlayer2.quodlibet": this.applyQuodLibetRating,
            "org.mpris.MediaPlayer2.Lollypop": this.applyLollypopRating
          };
          if (supported[this._player.busName]) {
            this._rhythmbox3Proxy = new DBusIface.RhythmboxRatings(this._player.busName);
            this._applyFunc = supported[this._player.busName];
          }
        }
      }
      this.rate = this._rate;
      this._buildStars();
    }
  }

  _buildStars() {
    this._starButton = [];
    for(let i=0; i < 5; i++) {
      // Create star icons
      let starIcon = new St.Icon({style_class: 'popup-menu-icon star-icon',
        icon_name: 'non-starred-symbolic'
      });
      // Create the button with starred icon
      this._starButton[i] = new St.Button({x_align: St.Align.MIDDLE,
        y_align: St.Align.MIDDLE,
        track_hover: true,
        child: starIcon
      });
      this._starButton[i]._rateValue = i + 1;
      if (this._applyFunc) {
        this._starButton[i].connect('notify::hover', (button) => {
          if (!this._isNuvolaPlayer || this.player._mediaServerPlayer.NuvolaCanRate) {
            let value = button.hover ? button._rateValue : this._value;
            for (let i = 0; i < 5; i++) {
              this._starButton[i].child.icon_name = i < value ? 'starred-symbolic' : 'non-starred-symbolic';
            }
          }
        });
        this._starButton[i].connect('clicked', (button) => {
          let rateValue = button._rateValue == this._value ? 0 : button._rateValue;
          this._applyFunc(rateValue);
        });
      }
      // Put the button in the box
      this.box.add(this._starButton[i]);
    }
  }

  _buildPithosRatings() {
    this.box.add_style_class_name('pithos-rating-box');
    this._ratingsIcon = new St.Icon({style_class: 'popup-menu-icon no-padding'});
    this._unRateButton = new St.Button({x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
      child: this._ratingsIcon
    });
    this.box.add(this._unRateButton);
    this._loveButton = new St.Button();
    this.box.add(this._loveButton);
    this._banButton = new St.Button();
    this.box.add(this._banButton);
    this._tiredButton = new St.Button();
    this.box.add(this._tiredButton);
    this._loveButton.label = _("Love");
    this._banButton.label = _("Ban");
    this._tiredButton.label = _("Tired");
    this._callbackId = 0;
    this._unRateButton.connect('clicked', () => {
      this._player._pithosRatings.UnRateSongRemote(this._player.state.trackObj);
    });
    this._banButton.connect('clicked', () => {
      this._player._pithosRatings.BanSongRemote(this._player.state.trackObj);
    });
    this._tiredButton.connect('clicked', () => {
      this._player._pithosRatings.TiredSongRemote(this._player.state.trackObj);
    });
    this._unRateButton.hide();
    this.box.set_width(-1);
  }

  _ratePithos(rating) {
    if (this._value == rating) {
      return;
    }
    if (this._callbackId!== 0) {
      this._loveButton.disconnect(this._callbackId);
    }
    // Tired or banned song won't show up in the trackbox,
    // and if a song is banned or set tired it will be skipped automatically.
    // Pithos doesn't even send metadata updates for the current song if it's banned or set tired.
    // The only ratings we need to worry about are unrated and loved.
    if (rating == '') {
      this._ratingsIcon.icon_name = null;
      this._unRateButton.hide();
      this._loveButton.label = _("Love");
      this._callbackId = this._loveButton.connect('clicked', () => {
        this._player._pithosRatings.LoveSongRemote(this._player.state.trackObj);
      });
    }
    else if (rating == 'love') {
      this._ratingsIcon.icon_name = 'emblem-favorite-symbolic';
      this._unRateButton.show();
      this._loveButton.label = _("UnLove");
      this._callbackId = this._loveButton.connect('clicked', () => {
        this._player._pithosRatings.UnRateSongRemote(this._player.state.trackObj);
      });
    }
    this._value = rating;
    this.box.set_width(-1);      
  }

  _rate(value) {
    // For Pithos versions without ratings support.
    if (value.constructor === String) {
      value = value == 'love' ? 5 : 0;
    }
    else {
      value = Math.min(Math.max(0, value), 5);
    }
    if (this._value == value) {
      return;
    }
    this._value = value;       
    for (let i = 0; i < 5; i++) {
      let icon_name = i < this._value ? 'starred-symbolic' : 'non-starred-symbolic';
      if (this.animating) {
        this._starButton[i].child.icon_name = icon_name;
      }
      else {
        let starChild = this._starButton[i].child;
        Mainloop.timeout_add(50 * i, () => {
          this._animateChange(starChild, 'icon_name', icon_name);
          return false;
        });
      }
    }
  }

  applyQuodLibetRating(value) {
    // Quod Libet works on 0.0 to 1.0 scores.
    // Quod Libet also does the right thing and emits a prop change signal
    // on ratings changes so we don't have to fake it and set it ourself.
    GLib.spawn_command_line_async("quodlibet --set-rating=%f".format(value / 5.0));
  }

  applyLollypopRating(value) {
    // Lollypop works on 0 to 5 scores.
    // Lollypop also does the right thing and emits a prop change signal
    // on ratings changes so we don't have to fake it and set it ourself.
    GLib.spawn_command_line_async("lollypop --set-rating=%s".format(value));
  }

  applyRhythmbox3Rating(value) {
    if (this._player.state.trackUrl) {
      this._rhythmbox3Proxy.SetEntryPropertiesRemote(this._player.state.trackUrl,
        {rating: GLib.Variant.new_double(value)});
      // Rhythmbox doesn't emit a prop change signal when we rate the song but it will more
      // than likely stick so we just fake it...
      this.rate(value);
    }
  }

  applyNuvolaRating(value) {
    if (this.player._mediaServerPlayer.NuvolaCanRate) {
      this.player._mediaServerPlayer.NuvolaSetRatingRemote(value / 5.0);
    }
  }

  applyRatingsExtension(value) {
    if (this._player.state.trackObj) {
      this._player._ratingsExtension.SetRatingRemote(this._player.state.trackObj, value / 5.0);
    }
  }
}
if (shellMinorVersion >= 34) {
  TrackRating = GObject.registerClass(
    {GTypeName: 'TrackRating'},
    TrackRating
  );
}


var ListSubMenu = class ListSubMenu extends PopupMenu.PopupSubMenuMenuItem {
  constructor(label) {
    if (shellMinorVersion >= 34) {
      super(label);
    } else {
      super(label, false);
      this._init(label);
    }
  }
  _init(label) {
    super._init(label, false);
    this.activeObject = null;
    this._hidden = false;
    this.menu = new SubMenu(this.actor, this._triangle, false);
    this.menu.connect('open-state-changed', this._subMenuOpenStateChanged.bind(this));
  }

  get hidden() {
    return this._hidden;
  }

  set hidden(value) {
    this._hidden = value;
  }

  hide() {
    this.menu.close();
    /*this.actor.hide();*/
    this.actor.opacity = 0;
    this.actor.set_height(0);
    this.hidden = true;
  }

  show() {
    this.actor.show();
    this.actor.opacity = 255;
    this.actor.set_height(-1);
    this.hidden = false;
  } 

  showAnimate() {
    if (!this.actor.get_stage() || !this._hidden)
      return;
    this.actor.set_height(-1);
    let [minHeight, naturalHeight] = this.actor.get_preferred_height(-1);
    this.actor.set_height(0);
    this.actor.show();
    Tweener.addTween(this.actor, {
      opacity: 255,
      height: naturalHeight,
      time: 0.25,
      onComplete() {
        this.show();
      },
      onCompleteScope: this
    });
  }

  hideAnimate() {
    if (!this.actor.get_stage() || this._hidden)
      return;
    Tweener.addTween(this.actor, {
      opacity: 0,
      height: 0,
      time: 0.25,
      onComplete() {
        this.hide();
      },
      onCompleteScope: this
    });
  }

  setObjectActive(objPath) {
    this.activeObject = objPath;
    this.menu._getMenuItems().forEach(function(listItem) {
      if (listItem.obj == objPath) {
        listItem.setOrnament(PopupMenu.Ornament.DOT);
      }
      else {
        listItem.setOrnament(PopupMenu.Ornament.NONE);
      }
    });
  }

  getItem(obj) {        
    let menuItems = this.menu._getMenuItems().filter(function(item) {
      return item.obj === obj;  
    });
    if (menuItems && menuItems[0]) {
      return menuItems[0];
    }
    else {
      return null;
    }
  }

  hasUniqueObjPaths(objects, isTracklistMetadata) {
    //Check for unique values in the playlist and tracklist object paths.
    let unique = objects.reduce(function(values, object) {
      if (isTracklistMetadata) {
        object = object["mpris:trackid"] ? object["mpris:trackid"].unpack() : "/org/mpris/MediaPlayer2/TrackList/NoTrack";
      }
      else {
        object = object[0];
      }
      values[object] = true;
      return values;
    }, {});
    return Object.keys(unique).length === objects.length;
  }

  _subMenuOpenStateChanged(menu, open) {
    if (open) {
      this.actor.add_style_pseudo_class('open');
      this.actor.add_accessible_state(Atk.StateType.EXPANDED);
      this.actor.add_style_pseudo_class('checked');
    }
    else {
      this.actor.remove_style_pseudo_class('open');
      this.actor.remove_accessible_state (Atk.StateType.EXPANDED);
      this.actor.remove_style_pseudo_class('checked');
    }
  }
}
if (shellMinorVersion >= 34) {
  ListSubMenu = GObject.registerClass(
    {GTypeName: 'ListSubMenu'},
    ListSubMenu
  );
}


var TrackList = class TrackList extends ListSubMenu {
  constructor(label, player) {
    if (shellMinorVersion >= 34) {
      super(label, player);
    } else {
      super(label);
      this._init(label, player);
    }
  }
  _init(label, player) {
    super._init(label);
    this.player = player;
    this.parseMetadata = Util.parseMetadata;
  }

  showRatings(value) {
    this.menu._getMenuItems().forEach(function(tracklistItem) {
      tracklistItem.showRatings(value);
    });
  }

  updateMetadata(UpdatedMetadata) {
    let metadata = {};
    this.parseMetadata(UpdatedMetadata, metadata);
    let trackListItem = this.getItem(metadata.trackObj);
    if (trackListItem) {
      trackListItem.updateMetadata(metadata);
    }
  }

  loadTracklist(trackListMetaData, showRatings) {
    this.menu.removeAll();
    //As per spec all object paths MUST be unique.
    //If we don't have unique object paths reject the whole array.
    let hasUniqueObjPaths = this.hasUniqueObjPaths(trackListMetaData, true);
    if (hasUniqueObjPaths) {
      trackListMetaData.forEach((trackMetadata) => {
        let metadata = {};
        this.parseMetadata(trackMetadata, metadata);
        //Don't add tracks with "/org/mpris/MediaPlayer2/TrackList/NoTrack" as the object path.
        //As per spec the "/org/mpris/MediaPlayer2/TrackList/NoTrack" object path means it's not a valid track.
        if (metadata.trackObj && metadata.trackObj !== '/org/mpris/MediaPlayer2/TrackList/NoTrack') {
          metadata.showRatings = showRatings;
          let trackUI = new TracklistItem(metadata, this.player);
          trackUI.connect('activate', () => {
            this.player.playTrack(trackUI.obj);
          });
          this.menu.addMenuItem(trackUI);
        }
      });
      if (this.activeObject) {
        this.setObjectActive(this.activeObject);
      }
    }
  }

}
if (shellMinorVersion >= 34) {
  TrackList = GObject.registerClass(
    {GTypeName: 'TrackList'},
    TrackList
  );
}


var Playlists = class Playlists extends ListSubMenu {
  constructor(label, player) {
    if (shellMinorVersion >= 34) {
      super(label, player);
    } else {
      super(label);
      this._init(label, player);
    }
  }
  _init(label, player) {
    super._init(label);
    this.player = player;
  }

  loadPlaylists(playlists) {
    this.menu.removeAll();
    //As per spec all object paths MUST be unique.
    //If we don't have unique object paths reject the whole array.
    let hasUniqueObjPaths = this.hasUniqueObjPaths(playlists);
    if (hasUniqueObjPaths) {
      playlists.forEach((playlist) => {
        let [obj, name] = playlist;
        //Don't add playlists with just "/" as the object path.
        //Playlist object paths that just contain "/" are a way to
        //indicate invalid playlists as per spec.
        if (obj !== '/') {
          let playlistUI = new PlaylistItem(name, obj);
          playlistUI.connect('activate', () => {
            this.player.playPlaylist(playlistUI.obj);
          });
          this.menu.addMenuItem(playlistUI);
        }
      });
      if (this.activeObject) {
        this.setObjectActive(this.activeObject);
      }
    }
  }

  updatePlaylist(UpdatedPlaylist) {
    let [obj, name] = UpdatedPlaylist;
    let playlistItem = this.getItem(obj);
    if (playlistItem) {
      playlistItem.updatePlaylistName(name);
    }
  }
}
if (shellMinorVersion >= 34) {
  Playlists = GObject.registerClass(
    {GTypeName: 'Playlists'},
    Playlists
  );
}


var PlaylistItem = class PlaylistItem extends PopupMenu.PopupBaseMenuItem {
  _init (text, obj) {
    super._init();
    this.obj = obj;
    this.label = new St.Label({text: text});
    this.actor.add(this.label);
  }

  updatePlaylistName(name) {
    if (this.label.text != name) {
      this.label.text = name;
    }
  }
}
if (shellMinorVersion >= 34) {
  PlaylistItem = GObject.registerClass(
    {GTypeName: 'PlaylistItem'},
    PlaylistItem
  );
}


var TracklistItem = class TracklistItem extends PopupMenu.PopupBaseMenuItem {
  _init (metadata, player) {
    super._init();
    this.actor.child_set_property(this._ornamentLabel, "y-fill", false);
    this.actor.child_set_property(this._ornamentLabel, "y-align", St.Align.MIDDLE);
    this._player = player;
    this._loveCallbackId = 0;
    this._banCallbackId = 0;
    this._tiredCallbackId = 0;
    this.obj = metadata.trackObj;
    this._setCoverIconAsync = Util.setCoverIconAsync;
    this._animateChange = Util.animateChange;
    this._rating = null;
    this._coverIcon = new St.Icon({style_class: 'small-cover-icon'});
    let _icon_box = new St.BoxLayout({height: 48, width: 48});
    _icon_box.add(this._coverIcon, {y_fill: false, y_align: St.Align.MIDDLE});
    this._artistLabel = new St.Label({style_class: 'track-info-artist'});
    this._titleLabel = new St.Label({style_class: 'track-info-title'});
    this._albumLabel = new St.Label({style_class: 'track-info-album'});
    this._ratingBox = new St.BoxLayout({style_class: 'no-padding track-info-album'});
    this._ratingBox.hide();
    this._box = new St.BoxLayout({vertical: true});
    this._box.add(this._artistLabel, {expand: true, y_fill: false, y_align: St.Align.MIDDLE});
    this._box.add(this._titleLabel, {expand: true, y_fill: false, y_align: St.Align.MIDDLE});
    this._box.add(this._albumLabel, {expand: true, y_fill: false, y_align: St.Align.MIDDLE});
    this._box.add(this._ratingBox, {expand: true, y_fill: false, y_align: St.Align.MIDDLE});
    this.actor.add(_icon_box, {y_fill: false, y_align: St.Align.MIDDLE});
    this.actor.add(this._box, {y_fill: false, y_align: St.Align.MIDDLE});
    this._validRatings = metadata.trackRating != 'no rating';
    if (this._player._pithosRatings) {
      this._rate = this._setPithosRating;
      if (this._validRatings) {
        this._buildPithosRatings(metadata.trackRating);
        this.showRatings(metadata.showRatings);
      }
      else {
        this._buildPithosRatings('');
        this.showRatings(false);
      }
    }
    else {
      this._rate = this._setStarRating;
      if (this._validRatings) {
        this._buildStars(metadata.trackRating);
        this.showRatings(metadata.showRatings);
      }
      else {
        this._buildStars(0);
        this.showRatings(false);
      }
    }
    this.updateMetadata(metadata);
  }

  updateMetadata(metadata) {
    this._setCoverIconAsync(this._coverIcon, metadata.trackCoverUrl);
    this._setArtist(metadata.trackArtist);
    this._setTitle(metadata.trackTitle);
    this._setAlbum(metadata.trackAlbum);
    this._validRatings = metadata.trackRating != 'no rating';
    if (this._validRatings) {
      this._rate(metadata.trackRating);
    }
    else {
      this.showRatings(false);
    }
  }

  _setArtist(artist) {
    if (this._artistLabel.text != artist) {
      this._animateChange(this._artistLabel, 'text', artist);
    }
  }

  _setTitle(title) {
    if (this._titleLabel.text != title) {
      this._animateChange(this._titleLabel, 'text', title);
    }
  }

  _setAlbum(album) {
    if (this._albumLabel.text != album) {
      this._animateChange(this._albumLabel, 'text', album);
    }
  }

  _buildStars(value) {
    // For Pithos versions without ratings support.
    if (value.constructor === String) {
      value = value == 'love' ? 5 : 0;
    }
    else {
      value = Math.min(Math.max(0, value), 5);
    }
    this._starIcon = [];
    for(let i=0; i < 5; i++) {
      let icon_name = i < value ? 'starred-symbolic' : 'non-starred-symbolic';
      this._starIcon[i] = new St.Icon({style_class: 'popup-menu-icon star-icon'});
      this._ratingBox.add(this._starIcon[i]);
      let starIcon = this._starIcon[i];
      Mainloop.timeout_add(50 * i, () => {
        this._animateChange(starIcon, 'icon_name', icon_name);
        return false;
      });

    }
    this._rating = value;
  }

  _buildPithosRatings(rating) {
    this._ratingBox.add_style_class_name('pithos-rating-box');
    this._ratingsIcon = new St.Icon({style_class: 'popup-menu-icon no-padding'});
    this._unRateButton = new St.Button({x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
      child: this._ratingsIcon
    });
    this._ratingBox.add(this._unRateButton, {y_align: St.Align.MIDDLE});
    this._loveButton = new St.Button();
    this._ratingBox.add(this._loveButton, {y_align: St.Align.MIDDLE});
    this._banButton = new St.Button();
    this._ratingBox.add(this._banButton, {y_align: St.Align.MIDDLE});
    this._tiredButton = new St.Button();
    this._ratingBox.add(this._tiredButton, {y_align: St.Align.MIDDLE});
    this._unrateCallbackId = this._unRateButton.connect('clicked', () => {
      this._player._pithosRatings.UnRateSongRemote(this.obj);
    });
    this._unRateButton.hide();
    this._setPithosRating(rating);
  }

  _setPithosRating(rating) {
    if (this._rating == rating) {
      return;
    }
    if (this._loveCallbackId !== 0) {
      this._loveButton.disconnect(this._loveCallbackId);
    }
    if (this._banCallbackId !== 0) {
      this._banButton.disconnect(this._banCallbackId);
    }
    if (this._tiredCallbackId !== 0) {
      this._tiredButton.disconnect(this._tiredCallbackId);
    }
    if (rating == '') {
      this._ratingsIcon.icon_name = null;
      this._unRateButton.hide();
      this._loveButton.label = _("Love");
      this._banButton.label = _("Ban");
      this._tiredButton.label = _("Tired");
      this._loveCallbackId = this._loveButton.connect('clicked', () => {
        this._player._pithosRatings.LoveSongRemote(this.obj);
      });
      this._banCallbackId = this._banButton.connect('clicked', () => {
        this._player._pithosRatings.BanSongRemote(this.obj);
      });
      this._tiredCallbackId = this._tiredButton.connect('clicked', () => {
        this._player._pithosRatings.TiredSongRemote(this.obj);
      });
    }

    else if (rating == 'love') {
      this._ratingsIcon.icon_name = 'emblem-favorite-symbolic';
      this._unRateButton.show();
      this._loveButton.label = _("UnLove");
      this._banButton.label = _("Ban");
      this._tiredButton.label = _("Tired");
      this._loveCallbackId = this._loveButton.connect('clicked', () => {
        this._player._pithosRatings.UnRateSongRemote(this.obj);
      });
      this._banCallbackId = this._banButton.connect('clicked', () => {
        this._player._pithosRatings.BanSongRemote(this.obj);
      });
      this._tiredCallbackId = this._tiredButton.connect('clicked', () => {
        this._player._pithosRatings.TiredSongRemote(this.obj);
      });
    }
    else if (rating == 'ban') {
      this._ratingsIcon.icon_name = 'dialog-error-symbolic';
      this._unRateButton.show();
      this._loveButton.label = _("Love");
      this._banButton.label = _("UnBan");
      this._tiredButton.label = _("Tired");
      this._loveCallbackId = this._loveButton.connect('clicked', () => {
        this._player._pithosRatings.LoveSongRemote(this.obj);
      });
      this._banCallbackId = this._banButton.connect('clicked', () => {
        this._player._pithosRatings.UnRateSongRemote(this.obj);
      });
      this._tiredCallbackId = this._tiredButton.connect('clicked', () => {
        this._player._pithosRatings.TiredSongRemote(this.obj);
      });
    }
    else if (rating == 'tired') {
      if (this._unrateCallbackId !== 0) {
        this._unRateButton.disconnect(this._unrateCallbackId);
      }
      // Once a song has been set tired it's rating can't be changed.
      // No need to connect button signals.
      this._ratingsIcon.icon_name = 'go-jump-symbolic';
      this._unRateButton.show();
      this._loveButton.label = _("Tired… (Can't be Changed)");
      this._loveButton.reactive = false;
      this._unRateButton.reactive = false;
      this._banButton.hide();
      this._tiredButton.hide();
      this._unrateCallbackId = 0;
      this._loveCallbackId = 0;
      this._banCallbackId = 0;
      this._tiredCallbackId = 0;
    }
    this._box.set_width(-1);
    this._rating = rating;
  }

  _setStarRating(value) {
    // For Pithos versions without ratings support.
    if (value.constructor === String) {
      value = value == 'love' ? 5 : 0;
    }
    else {
      value = Math.min(Math.max(0, value), 5);
    }
    if (this._rating != value) {
      this._rating = value;
      for (let i = 0; i < 5; i++) {
        let icon_name = i < value ? 'starred-symbolic' : 'non-starred-symbolic';
        let starIcon = this._starIcon[i];
        Mainloop.timeout_add(50 * i, () => {
          this._animateChange(starIcon, 'icon_name', icon_name);
          return false;
        });
      }
    }
  }

  showRatings(value) {
    if (value && this._validRatings) {
      this._albumLabel.hide();
      this._ratingBox.show();
    }
    else {
      this._ratingBox.hide();
      this._albumLabel.show();
    }
  }
}
if (shellMinorVersion >= 34) {
  TracklistItem = GObject.registerClass(
    {GTypeName: 'TracklistItem'},
    TracklistItem
  );
}

