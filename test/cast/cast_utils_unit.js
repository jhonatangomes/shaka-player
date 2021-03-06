/**
 * @license
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

describe('CastUtils', () => {
  const CastUtils = shaka.cast.CastUtils;
  const FakeEvent = shaka.util.FakeEvent;

  it('includes every Player member', () => {
    const ignoredMembers = [
      'constructor',  // JavaScript added field
      'getSharedConfiguration',  // Handled specially
      'getNetworkingEngine',  // Handled specially
      'getMediaElement',  // Handled specially
      'setMaxHardwareResolution',
      'destroy',  // Should use CastProxy.destroy instead
      'drmInfo',  // Too large to proxy
      'getManifest', // Too large to proxy
      // TODO(vaage): Remove |getManifestUri| references in v2.6.
      'getManifestUri',  // Handled specially by CastProxy
      'getManifestParserFactory',  // Would not serialize.

      // Test helper methods (not @export'd)
      'createDrmEngine',
      'createNetworkingEngine',
      'createPlayhead',
      'createMediaSource',
      'createMediaSourceEngine',
      'createStreamingEngine',
    ];

    const castMembers = CastUtils.PlayerVoidMethods
        .concat(CastUtils.PlayerPromiseMethods);
    for (const name in CastUtils.PlayerGetterMethods) {
      castMembers.push(name);
    }
    for (const name in CastUtils.PlayerGetterMethodsThatRequireLive) {
      castMembers.push(name);
    }
    const playerMembers = Object.keys(shaka.Player.prototype).filter(
        (name) => {
          // Private members end with _.
          return !ignoredMembers.includes(name) && !name.endsWith('_');
        });

    // To make debugging easier, don't check that they are equal; instead check
    // that neither has any extra entries.
    const extraCastMembers = castMembers.filter((name) => {
      return !playerMembers.includes(name);
    });
    const extraPlayerMembers = playerMembers.filter((name) => {
      return !castMembers.includes(name);
    });
    expect(extraCastMembers).toEqual([]);
    expect(extraPlayerMembers).toEqual([]);
  });

  describe('serialize/deserialize', () => {
    it('transfers infinite values and NaN', () => {
      const orig = {
        'nan': NaN,
        'positive_infinity': Infinity,
        'negative_infinity': -Infinity,
        'null': null,
        'true': true,
        'false': false,
        'one': 1,
        'string': 'a string',
      };

      const serialized = CastUtils.serialize(orig);
      // The object is turned into a string.
      expect(typeof serialized).toBe('string');

      // The deserialized object matches the original.
      const deserialized = CastUtils.deserialize(serialized);
      for (const k in orig) {
        expect(deserialized[k]).toEqual(orig[k]);
      }
    });

    it('transfers real Events', () => {
      // new Event() is not usable on IE11:
      const event =
      /** @type {!CustomEvent} */ (document.createEvent('CustomEvent'));
      event.initCustomEvent('myEventType', false, false, null);

      // Properties that can definitely be transferred.
      const nativeProperties = [
        'bubbles',
        'type',
        'cancelable',
        'defaultPrevented',
      ];
      const extraProperties = {
        'key': 'value',
        'true': true,
        'one': 1,
      };

      for (const k in extraProperties) {
        event[k] = extraProperties[k];
      }

      // The event is turned into a string.
      const serialized = CastUtils.serialize(event);
      expect(typeof serialized).toBe('string');

      // The string is turned back into an object.
      const deserialized = CastUtils.deserialize(serialized);
      expect(typeof deserialized).toBe('object');

      // The object can be used to construct a FakeEvent.
      const fakeEvent = new FakeEvent(deserialized['type'], deserialized);

      // The fake event has the same type and properties as the original.
      nativeProperties.forEach((k) => {
        expect(fakeEvent[k]).toEqual(event[k]);
      });
      for (const k in extraProperties) {
        expect(fakeEvent[k]).toEqual(event[k]);
      }
    });

    it('transfers dispatched FakeEvents', (done) => {
      const event = new FakeEvent('custom');

      // Properties that can definitely be transferred.
      const nativeProperties = [
        'bubbles',
        'type',
        'cancelable',
        'defaultPrevented',
      ];
      const extraProperties = {
        'key': 'value',
        'true': true,
        'one': 1,
      };

      for (const k in extraProperties) {
        event[k] = extraProperties[k];
      }

      const target = new shaka.util.FakeEventTarget();
      target.addEventListener(event.type, () => {
        try {
          // The event is turned into a string.
          const serialized = CastUtils.serialize(event);
          expect(typeof serialized).toBe('string');

          // The string is turned back into an object.
          const deserialized = CastUtils.deserialize(serialized);
          expect(typeof deserialized).toBe('object');

          // The deserialized event has the same type and properties as the
          // original.
          nativeProperties.forEach((k) => {
            expect(deserialized[k]).toEqual(event[k]);
          });
          for (const k in extraProperties) {
            expect(deserialized[k]).toEqual(event[k]);
          }
        } catch (exception) {
          fail(exception);
        }
        done();
      });
      target.dispatchEvent(event);
    });

    describe('TimeRanges', () => {
      /** @type {!HTMLVideoElement} */
      let video;
      /** @type {!shaka.util.EventManager} */
      let eventManager;
      /** @type {!shaka.media.MediaSourceEngine} */
      let mediaSourceEngine;

      beforeAll(() => {
        video = shaka.util.Dom.createVideoElement();
        document.body.appendChild(video);
      });

      beforeEach((done) => {
        // The TimeRanges constructor cannot be used directly, so we load a clip
        // to get ranges to use.
        const fakeVideoStream = {
          mimeType: 'video/mp4',
          codecs: 'avc1.42c01e',
        };
        const initSegmentUrl = '/base/test/test/assets/sintel-video-init.mp4';
        const videoSegmentUrl =
            '/base/test/test/assets/sintel-video-segment.mp4';

        // Wait for the media source to be open.
        eventManager = new shaka.util.EventManager();
        eventManager.listen(video, 'error', onError);

        function onError() {
          fail('Error code ' + (video.error ? video.error.code : 0));
        }

        mediaSourceEngine = new shaka.media.MediaSourceEngine(
            video,
            new shaka.test.FakeClosedCaptionParser(),
            new shaka.test.FakeTextDisplayer());

        const ContentType = shaka.util.ManifestParserUtils.ContentType;
        const initObject = new Map();
        initObject.set(ContentType.VIDEO, fakeVideoStream);

        mediaSourceEngine.init(initObject, false).then(() => {
          return shaka.test.Util.fetch(initSegmentUrl);
        }).then((data) => {
          return mediaSourceEngine.appendBuffer(ContentType.VIDEO, data,
              null, null, /* hasClosedCaptions */ false);
        }).then(() => {
          return shaka.test.Util.fetch(videoSegmentUrl);
        }).then((data) => {
          return mediaSourceEngine.appendBuffer(ContentType.VIDEO, data,
              null, null, /* hasClosedCaptions */ false);
        }).catch(fail).then(done);
      });

      afterEach(async () => {
        eventManager.release();

        if (mediaSourceEngine) {
          await mediaSourceEngine.destroy();
        }

        // "unload" the video element.
        video.removeAttribute('src');
        video.load();
      });

      afterAll(() => {
        document.body.removeChild(video);
      });

      quarantinedIt('deserialize into equivalent objects', () => {
        const buffered = video.buffered;

        // The test is less interesting if the ranges are empty.
        expect(buffered.length).toBeGreaterThan(0);

        // The TimeRanges object is turned into a string.
        const serialized = CastUtils.serialize(buffered);
        expect(typeof serialized).toBe('string');

        // Expect the deserialized version to look like the original.
        const deserialized = CastUtils.deserialize(serialized);
        expect(deserialized.length).toEqual(buffered.length);
        expect(deserialized.start).toEqual(jasmine.any(Function));
        expect(deserialized.end).toEqual(jasmine.any(Function));

        for (let i = 0; i < deserialized.length; ++i) {
          // Not exact because of the possibility of rounding errors.
          expect(deserialized.start(i)).toBeCloseTo(buffered.start(i));
          expect(deserialized.end(i)).toBeCloseTo(buffered.end(i));
        }
      });
    });
  });
});
