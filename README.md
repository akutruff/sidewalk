This project is under the MIT LICENSE in the LICENSE file.

# IMPORTANT WARNINGS

**This project is not a replacement for human review. You must review every single report prior to submission to 311 and continually monitor your submissions.**

1. Submitting 311's is a very serious matter, and you must strive to be as accurate as possible.
1. This project provides AI-assistance only to help identify objects in locations. The AI and code in this project cannot and does not determine if any infraction has taken place. **Any and all 311 reports must be reviewed by a human prior to submission.** To not do so is irresponsible and would lead to false reports being submitted to 311. **Again, you must review every single clip TWICE prior to submission to 311.**
1. This project is **not** affiliated with NYC311 or the City of New York in any way.
1. Do not disrupt any services.
1. Do not use this project to break any laws.
1. Do not use this project to violate the privacy of others and/or publicly publish a person's information.
1. Do not use this project to be a jerk.
1. This project is still in early development. There could be bugs.
1. If you encounter an error stop using the project and do not submit anything.
1. If you are unsure of anything whatsoever, do not use this project.
1. Right now this project is only setup to detect and report two wheeled vehicles and report it as a sidewalk riding violation.  Detection of illegally parked cars is next on the roadmap.

# Sidewalk

An AI object detection toolchain to help citizens identify and and then easily review potential violations of the law and submit those violations to 311.

This is the project I threw together to submit over 5,000 reports of illegal bicycle riding to 311. 

[YouTube video of 5,000 submissions](https://www.youtube.com/watch?v=_F97_73lQjk)

An [article](https://w42st.com/post/mission-311-over-5000-sidewalk-cycling-reports-to-spark-nypd-attention-what-can-one-person-do/) on the work written by w42st.com

This was a quickly constructed side project that grew fast and so it is very cobbled together. The web portion is taped-together vanilla HTML and JS, with very little regard for UX. It should all be rewritten.

## High level overview

1. Setup a camera in a fixed location where it will never be moved.
1. Run [Frigate](https://frigate.video) to detect objects in the camera's view by drawing zones and tuning the AI.
1. As objects are detected in zones, they will be recorded as events in Frigate.
1. Fill out the many configuration files that includes your login information, the problem description, the address.
1. Run the checker script on a powerful PC that will review the frigate events with Ultralytics to greatly reduce false positives. It will review clips every 5 minutes.
1. Run the Sidewalk UI and click "review clips"
1. All clips since your last submission will be downloaded from Frigate, and you will be presented with a web interface to review the clips. The download could take quite a while so wait for the page to load.
1. Once the review page shows up, watch each clip to verify that there was an infraction. Click "delete" if no infractions is observed, or click "valid" if there was an infraction observed. Do this for all events.
1. Refresh the page and do it all again. This double checking is extremely important to prevent false reports from being submitted to 311.
1. After you have reviewed all clips, go back to the main page.
1. Refresh the main page
1. Check the 'dry run' box, and then click 'submit'
1. The system will fillout out the 311 web page but not click the final submit button on the page as it is a dry run. At this stage, you should go to the `shots` directory under the event folder that you tried to submit. Inside there are screenshots. Look at the last shots to verify that the all of the 311 information is correct and that your contact information is up to date.  You should also see a file attached in the clip matching your file name, or a link to the S3 file will be in the description if you are using S3.
1. If everything looks good, uncheck the dry run box and click submit again.
1. The system will record the submission in json files in each events directory along with the screenshots. DO NOT DELETE THESE FILES AND BACK THEM UP. They are your only record of what was submitted to 311, and the presence of the service request json prevents the system from submitting the same clip twice.

## Setup.

1. Pull this repository
2. Make sure you have Docker installed and a dockerhub account.

3. Run:

```bash
./build.sh -t <your dockerhub username>/sidewalk:latest
``` 

This will also create docker buildx builder that supports multi-platform builds. (use `docker buildx ls` to see the new builder)

This will build a docker image of the web ui and 311 submitter.  Each person should maintain their own docker image.  I will not be releasing a public docker image for this part of the project.

4. Copy the `deployment-examples` directory to someplace else and use it as a template for your setup.

5. Get the [Frigate](https://frigate.video) configuration setup and working.  Go slowly with the instructions.   

Here's a good set of gear for Frigate running at full 30fps at the highest resolution.

- [Coral USB accelerator](https://coral.ai/products/accelerator/) - allows real-time inferece.
- [Beelink S12 Pro Mini PC](https://www.amazon.com/gp/product/B0BVLS7ZHP/ref=ppx_yo_dt_b_search_asin_title?ie=UTF8&th=1) but must be installed with th latest version of Ubuntu to support the N100 and hardware acceleration
- [EmpireTech Ultra Low Light IPC-T54IR-ZE](https://www.amazon.com/gp/product/B08LCY27TD/ref=ppx_yo_dt_b_search_asin_title?ie=UTF8&psc=1) - this is a rebranded Dahua camera that is excellent at night as well as day.

6. Draw zones in Frigate for where you want to detect objects.
7. Copy the zone coordinates you created in Frigate to the `zones.json` file in the `checker/config` directory making sure the names are the same.
8. Setup `sidewalk` storage

You should pick a single storage location as your source of truth to store all files that are downloaded from frigate and submitted to 311. 

File structure:

- `311-events/events` - Stores all events, 311 website screenshots, frigate metadata, and the service request number.  (NEVER delete anything in this directoy. It is your database of events that you have submitted to 311) Back this up to Google Drive or a similar service.
- `311-events/events-staging` - Temporary storage for when you are reviewing clips and tracks how many times you removed them. This folder may be emptied.
- `311-events/config` - Stores configuration files such as `service-request-definitions.json`

9. Fillout `service-request-definitions.json` that describes the potential 311 violation to associate with each zone. 

10. Fill out the various values `.env` file and `docker-compose.yml` for `sidewalk`. 

11. Verify sidewalk is up and running and able to fetch events from frigate after you've detected something.

12. Setup the `checker` container that needs to run on a PC with a GPU.  This container will download clips from frigate and run the a much stronger AI to reduce false positives.  The container will scan events every 5 minutes so keep that in mind as you review clips.

13. Do the instructions at the top of the page carefully and perform dry run before doing any submission.  Verify that all your screenshots make sense and have correct information. You can also just work with one clip at a time by only validating the oldest clip that appears on the "review clips" page.  The rest of the events will be ignored.
